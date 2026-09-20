const db = require('../../config/database');
const repository = require('./whatsapp.alertas.repository');
const eventos = require('./whatsapp.alertas.eventos');

const TIPO_USUARIO_PRINCIPAL = {
  emergencia: 'doctor',
  recepcion: 'recepcion',
  consentimiento: 'recepcion',
};

const CONTENIDO_POR_TIPO = {
  emergencia: {
    titulo: 'Atención médica urgente',
    mensaje: 'Una conversación de WhatsApp requiere atención médica urgente.',
  },
  recepcion: {
    titulo: 'Atención de Recepción',
    mensaje: 'Una conversación de WhatsApp requiere atención de Recepción.',
  },
  consentimiento: {
    titulo: 'Aviso de privacidad rechazado',
    mensaje: 'Un tutor no aceptó el aviso de privacidad y tratamiento de datos personales.',
  },
};

class AlertaValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function claveCanalUsuario(alertaId, usuarioId, canal) {
  return `alerta:${alertaId}:usuario:${usuarioId}:${canal}`;
}

async function prepararCanales(alerta, destinatarios, trx) {
  for (const destinatario of destinatarios) {
    for (const canal of ['portal', 'navegador']) {
      await repository.registrarIntentoCanal(
        {
          claveIdempotencia: claveCanalUsuario(alerta.id, destinatario.usuario_id, canal),
          alertaId: alerta.id,
          destinatarioId: destinatario.id,
          canal,
          destinoNormalizado: `usuario:${destinatario.usuario_id}`,
        },
        trx,
      );
    }
  }
}

function validarSolicitud({ claveIdempotencia, tipoAlerta, conversacionId, origen }) {
  if (!TIPO_USUARIO_PRINCIPAL[tipoAlerta]) {
    throw new AlertaValidationError(`Tipo de alerta no controlado: "${tipoAlerta}".`);
  }
  if (!claveIdempotencia || !conversacionId || !origen) {
    throw new AlertaValidationError(
      'claveIdempotencia, conversacionId y origen son obligatorios para crear una alerta.',
    );
  }
}

async function registrarSolicitudAlerta({
  claveIdempotencia,
  tipoAlerta,
  conversacionId,
  grupoId,
  mensajeOrigenId,
  whatsappMessageIdOrigen,
  telefonoExterno,
  origen,
  prioridad,
  solicitadaEn,
  tokensEntrada = 0,
  tokensSalida = 0,
  trx,
}) {
  validarSolicitud({ claveIdempotencia, tipoAlerta, conversacionId, origen });

  if (!trx) {
    return db.transaction((transaccion) =>
      registrarSolicitudAlerta({
        claveIdempotencia,
        tipoAlerta,
        conversacionId,
        grupoId,
        mensajeOrigenId,
        whatsappMessageIdOrigen,
        telefonoExterno,
        origen,
        prioridad,
        solicitadaEn,
        tokensEntrada,
        tokensSalida,
        trx: transaccion,
      }),
    );
  }

  return repository.crearAlerta(
    {
      claveIdempotencia,
      tipoAlerta,
      conversacionId,
      grupoId,
      mensajeOrigenId,
      whatsappMessageIdOrigen,
      telefonoExterno,
      origen,
      prioridad,
      solicitadaEn,
      tokensEntrada,
      tokensSalida,
    },
    trx,
  );
}

async function distribuirAlerta(alerta, trx) {
  const principales = await repository.resolverUsuarios(
    TIPO_USUARIO_PRINCIPAL[alerta.tipo_alerta],
    trx,
  );
  const administradores = await repository.resolverUsuarios('admin', trx);
  const usuarios = [...principales, ...administradores];
  const resolucion =
    principales.length > 0
      ? 'principal'
      : administradores.length > 0
        ? 'respaldo_admin'
        : 'sin_destinatarios';
  const esRespaldoAdmin = principales.length === 0 && administradores.length > 0;
  await repository.guardarResolucion(alerta.id, resolucion, trx);

  const destinatarios = await repository.guardarDestinatarios(
    alerta.id,
    usuarios,
    esRespaldoAdmin,
    trx,
  );
  await prepararCanales({ ...alerta, resolucion_destinatarios: resolucion }, destinatarios, trx);
  return {
    alerta: { ...alerta, resolucion_destinatarios: resolucion },
    destinatarios,
  };
}

async function solicitarAlerta(datos) {
  validarSolicitud(datos);
  if (!datos.trx) {
    const resultado = await db.transaction((trx) => solicitarAlerta({ ...datos, trx }));
    if (resultado.esNueva) eventos.publicarActualizacion();
    return resultado;
  }

  const { alerta, esNueva } = await registrarSolicitudAlerta(datos);
  if (!esNueva) return { alerta, esNueva: false };

  return { ...(await distribuirAlerta(alerta, datos.trx)), esNueva: true };
}

async function procesarSiguienteAlertaPendiente() {
  const resultado = await db.transaction(async (trx) => {
    const alerta = await repository.buscarSiguientePendienteResolucion(trx);
    if (!alerta) return null;
    return distribuirAlerta(alerta, trx);
  });
  if (resultado) eventos.publicarActualizacion();
  return resultado;
}

async function listarPendientes(usuarioId) {
  const alertas = await repository.listarPendientesParaUsuario(usuarioId);
  await repository.registrarVisualizacionPortal(
    alertas.map((alerta) => alerta.id),
    usuarioId,
  );
  return alertas.map((alerta) => ({
    id: alerta.id,
    tipo: alerta.tipo_alerta,
    titulo: CONTENIDO_POR_TIPO[alerta.tipo_alerta].titulo,
    mensaje: CONTENIDO_POR_TIPO[alerta.tipo_alerta].mensaje,
    telefonoExterno: alerta.telefono_externo,
    conversacionId: alerta.conversacion_id,
    creadaEn: alerta.creado_en,
    intencionClasificada: alerta.intencion_resuelta ?? null,
  }));
}

async function registrarResultadoNavegador(alertaId, usuarioId, { estado, error }) {
  if (!['enviado', 'no_disponible', 'fallido'].includes(estado)) {
    throw new AlertaValidationError('Estado de notificación de navegador inválido.');
  }
  const registrado = await repository.registrarResultadoNavegador(alertaId, usuarioId, {
    estado,
    errorTecnico: error ? String(error).slice(0, 500) : null,
  });
  if (!registrado) throw new AlertaValidationError('La alerta no está disponible.', 403);
  return { ok: true };
}

async function atender(alertaId, usuarioId) {
  const resultado = await repository.atender(alertaId, usuarioId);
  if (resultado.resultado === 'no_encontrada') {
    throw new AlertaValidationError('La alerta no existe.', 404);
  }
  if (resultado.resultado === 'no_autorizado') {
    throw new AlertaValidationError('No estás autorizado para atender esta alerta.', 403);
  }
  if (resultado.resultado === 'ya_atendida') {
    throw new AlertaValidationError('Esta alerta ya fue atendida por otro usuario.', 409);
  }
  eventos.publicarActualizacion();
  return resultado.alerta;
}

function esRespuestaAAlertaInterna(contextWamid) {
  return repository.esWamidDeAlertaInterna(contextWamid);
}

module.exports = {
  registrarSolicitudAlerta,
  solicitarAlerta,
  procesarSiguienteAlertaPendiente,
  listarPendientes,
  registrarResultadoNavegador,
  atender,
  esRespuestaAAlertaInterna,
  AlertaValidationError,
  CONTENIDO_POR_TIPO,
};
