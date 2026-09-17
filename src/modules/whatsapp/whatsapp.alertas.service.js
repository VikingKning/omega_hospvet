const db = require('../../config/database');
const env = require('../../config/env');
const outbox = require('./whatsapp.outbox');
const repository = require('./whatsapp.alertas.repository');
const eventos = require('./whatsapp.alertas.eventos');

const TIPO_USUARIO_PRINCIPAL = {
  emergencia: 'doctor',
  recepcion: 'recepcion',
};

const PLANTILLA_META_POR_TIPO = {
  emergencia: 'alerta_emergencia_personal_v1',
  recepcion: 'alerta_recepcion_personal_v1',
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
};

class AlertaValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizarTelefonoPersonal(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (/^\d{10}$/.test(digitos)) return `52${digitos}`;
  if (/^52\d{10}$/.test(digitos)) return digitos;
  if (/^521\d{10}$/.test(digitos)) return `52${digitos.slice(3)}`;
  return null;
}

function claveCanalUsuario(alertaId, usuarioId, canal) {
  return `alerta:${alertaId}:usuario:${usuarioId}:${canal}`;
}

function claveCanalWhatsapp(alertaId, telefono) {
  return `alerta:${alertaId}:telefono:${telefono}:whatsapp`;
}

function payloadWhatsapp(tipoAlerta, telefonoExterno) {
  return {
    tipo: 'template',
    destinatarioTelefono: null,
    plantilla: {
      name: PLANTILLA_META_POR_TIPO[tipoAlerta],
      language: { code: 'es_MX' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: telefonoExterno || 'sin número disponible' }],
        },
      ],
    },
  };
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
    if (!destinatario.telefono_normalizado) {
      await repository.registrarIntentoCanal(
        {
          claveIdempotencia: claveCanalUsuario(alerta.id, destinatario.usuario_id, 'whatsapp'),
          alertaId: alerta.id,
          destinatarioId: destinatario.id,
          canal: 'whatsapp',
          numeroIntento: 1,
          estado: 'no_aplicable',
          errorTecnico: 'El usuario no tiene un teléfono válido y normalizable.',
          intentadoEn: trx.fn.now(),
        },
        trx,
      );
    }
  }

  const porTelefono = new Map();
  for (const destinatario of destinatarios) {
    if (destinatario.telefono_normalizado && !porTelefono.has(destinatario.telefono_normalizado)) {
      porTelefono.set(destinatario.telefono_normalizado, destinatario);
    }
  }

  for (const [telefono, destinatario] of porTelefono) {
    const clave = claveCanalWhatsapp(alerta.id, telefono);
    const intentoCanal = await repository.registrarIntentoCanal(
      {
        claveIdempotencia: clave,
        alertaId: alerta.id,
        destinatarioId: destinatario.id,
        canal: 'whatsapp',
        destinoNormalizado: telefono,
      },
      trx,
    );
    const payload = payloadWhatsapp(alerta.tipo_alerta, alerta.telefono_externo);
    payload.destinatarioTelefono = telefono;
    const { intent } = await outbox.registrarIntento(
      {
        claveIdempotencia: clave,
        tipoEnvio: 'alerta_interna',
        origenFuncional: 'alerta_interna_personal',
        conversacionId: null,
        destinatarioTelefono: telefono,
        payloadFuncional: payload,
        usaPlantilla: true,
        categoriaFacturacionMeta: 'UTILITY',
      },
      trx,
    );
    await repository.vincularOutbox(intentoCanal.id, intent.intent_id, trx);
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
  let usuarios = await repository.resolverUsuarios(TIPO_USUARIO_PRINCIPAL[alerta.tipo_alerta], trx);
  let resolucion = 'principal';
  let esRespaldoAdmin = false;
  if (usuarios.length === 0) {
    usuarios = await repository.resolverUsuarios('admin', trx);
    resolucion = usuarios.length > 0 ? 'respaldo_admin' : 'sin_destinatarios';
    esRespaldoAdmin = usuarios.length > 0;
  }
  await repository.guardarResolucion(alerta.id, resolucion, trx);

  const destinatarios = await repository.guardarDestinatarios(
    alerta.id,
    usuarios,
    esRespaldoAdmin,
    normalizarTelefonoPersonal,
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

async function procesarSiguienteEnvioWhatsapp() {
  const intento = await repository.reclamarEnvioWhatsapp();
  if (!intento) return null;
  const intentOutbox = await repository.buscarOutbox(intento.outbox_id);
  if (!intentOutbox) {
    await repository.marcarEnvioWhatsapp(intento.id, {
      estado: 'fallido',
      errorTecnico: 'No existe el intento técnico asociado en outbox_whatsapp.',
    });
    return { id: intento.id, resultado: 'fallido' };
  }

  let resultado;
  try {
    resultado = await outbox.ejecutarIntento(intentOutbox.clave_idempotencia);
  } catch (err) {
    resultado = { enviado: false, error: err.message };
  }
  if (!resultado.enviado) {
    await repository.marcarEnvioWhatsapp(
      intento.id,
      { estado: 'fallido', errorTecnico: resultado.error ?? resultado.motivo ?? 'Fallo de envío.' },
      env.whatsapp.atencionHumanaReintentoSegundos,
    );
    return { id: intento.id, resultado: 'fallido' };
  }

  await repository.marcarEnvioWhatsapp(intento.id, {
    estado: 'enviado',
    identificadorExterno: resultado.wamid,
  });
  return { id: intento.id, resultado: 'enviado' };
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
  procesarSiguienteEnvioWhatsapp,
  listarPendientes,
  registrarResultadoNavegador,
  atender,
  esRespuestaAAlertaInterna,
  normalizarTelefonoPersonal,
  payloadWhatsapp,
  AlertaValidationError,
  PLANTILLA_META_POR_TIPO,
  CONTENIDO_POR_TIPO,
};
