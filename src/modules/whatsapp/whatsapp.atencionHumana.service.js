const db = require('../../config/database');
const logger = require('../../config/logger');
const repository = require('./whatsapp.atencionHumana.repository');
const outbox = require('./whatsapp.outbox');
const alertasService = require('./whatsapp.alertas.service');

const TEXTO_TRANSFERENCIA =
  'Tu conversación ha sido canalizada al personal de Omega para que continúe con la atención. ' +
  'A partir de este momento, el asistente automático dejará de responder temporalmente.';

const TEXTO_TRANSFERENCIA_POR_TIPO = {
  generico: TEXTO_TRANSFERENCIA,
  agenda_consulta_sin_enlace:
    'En este momento no podemos mostrar el enlace de reservación para Consulta. ' +
    'Recepción continuará con tu atención.',
  agenda_estetica_sin_enlace:
    'En este momento no podemos mostrar el enlace de reservación para Estética. ' +
    'Recepción continuará con tu atención.',
};

const ORIGENES_VALIDOS = ['emergencia', 'recepcion', 'consentimiento'];

class AtencionHumanaValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function claveOutboxTransferencia(solicitudId) {
  return `atencion_humana:${solicitudId}:transferencia`;
}

async function solicitarAtencionHumana({
  conversacionId,
  origen,
  prioridad,
  claveIdempotencia,
  referenciasFuncionales,
  envioPrevioId,
  destinatarioTelefono,
  tipoAviso = 'generico',
  origenAlerta = origen,
  registrarAlerta = true,
  ahora = new Date(),
  trx,
}) {
  if (!ORIGENES_VALIDOS.includes(origen)) {
    throw new AtencionHumanaValidationError(
      `Origen de atención humana no controlado: "${origen}".`,
    );
  }
  if (!conversacionId || !claveIdempotencia || !destinatarioTelefono) {
    throw new AtencionHumanaValidationError(
      'conversacionId, claveIdempotencia y destinatarioTelefono son obligatorios.',
    );
  }
  if (!Object.hasOwn(TEXTO_TRANSFERENCIA_POR_TIPO, tipoAviso)) {
    throw new AtencionHumanaValidationError(
      `Tipo de aviso de atención humana no controlado: "${tipoAviso}".`,
    );
  }

  if (!trx) {
    const resultado = await db.transaction((transaccion) =>
      solicitarAtencionHumana({
        conversacionId,
        origen,
        prioridad,
        claveIdempotencia,
        referenciasFuncionales,
        envioPrevioId,
        destinatarioTelefono,
        tipoAviso,
        origenAlerta,
        registrarAlerta,
        ahora,
        trx: transaccion,
      }),
    );
    return resultado;
  }

  const { solicitud, esNueva } = await repository.solicitarAtencionHumana({
    conversacionId,
    origen,
    prioridad,
    claveIdempotencia,
    referenciasFuncionales,
    envioPrevioId,
    ahora,
    trx,
  });

  if (!esNueva) {
    return solicitud;
  }

  const { intent } = await outbox.registrarIntento(
    {
      claveIdempotencia: claveOutboxTransferencia(solicitud.id),
      tipoEnvio: 'conversacional',
      origenFuncional: 'atencion_humana',
      conversacionId,
      destinatarioTelefono,
      payloadFuncional: {
        tipo: 'text',
        destinatarioTelefono,
        texto: TEXTO_TRANSFERENCIA_POR_TIPO[tipoAviso],
      },
      usaPlantilla: false,
    },
    trx,
  );
  await repository.marcarSolicitudOutbox(solicitud.id, intent.intent_id, trx);

  if (registrarAlerta) {
    await alertasService.registrarSolicitudAlerta({
      claveIdempotencia: `atencion_humana:${claveIdempotencia}`,
      tipoAlerta: origen,
      conversacionId,
      grupoId: referenciasFuncionales?.groupId ?? null,
      mensajeOrigenId: referenciasFuncionales?.mensajeOrigenId ?? null,
      whatsappMessageIdOrigen: referenciasFuncionales?.whatsappMessageId ?? null,
      telefonoExterno: destinatarioTelefono,
      origen: origenAlerta,
      solicitadaEn: ahora,
      tokensEntrada: 0,
      tokensSalida: 0,
      trx,
    });
  }

  return { ...solicitud, outbox_id: intent.intent_id };
}

async function procesarSiguienteSolicitudPendiente() {
  const solicitud = await repository.reclamarSolicitudPendiente();
  if (!solicitud) return null;

  let resultado;
  try {
    resultado = await outbox.ejecutarIntento(claveOutboxTransferencia(solicitud.id));
  } catch (err) {
    logger.error(
      { err, solicitudId: solicitud.id, conversacionId: solicitud.conversacion_id },
      'Falló el envío del aviso de transferencia a atención humana.',
    );
    await repository.marcarSolicitudFallidaReintentable(solicitud.id);
    return { id: solicitud.id, resultado: 'fallida_reintentable' };
  }

  if (!resultado.enviado) {
    if (resultado.motivo === 'envio_en_progreso') {
      return { id: solicitud.id, resultado: 'enviando' };
    }
    logger.error(
      {
        solicitudId: solicitud.id,
        conversacionId: solicitud.conversacion_id,
        errorCodigo: resultado.errorCodigo,
        error: resultado.error,
      },
      'Meta rechazó el aviso de transferencia a atención humana; se reintentará.',
    );
    await repository.marcarSolicitudFallidaReintentable(solicitud.id);
    return { id: solicitud.id, resultado: 'fallida_reintentable' };
  }

  const confirmada = await repository.confirmarTransferenciaEnviada(solicitud.id, {
    conversacionId: solicitud.conversacion_id,
    ahora: new Date(),
  });
  if (!confirmada) {
    logger.warn(
      { solicitudId: solicitud.id, conversacionId: solicitud.conversacion_id },
      'Aviso de transferencia enviado, pero la conversación ya no admite pasar a atencion_humana.',
    );
  }

  return { id: solicitud.id, resultado: 'enviada' };
}

async function cerrarSiguienteAtencionHumanaVencida() {
  return repository.reclamarAtencionHumanaVencida();
}

async function registrarEchoManual({
  whatsappMessageId,
  telefonoTutor,
  phoneNumberId,
  tipoMensaje,
  recibidoEn,
}) {
  const telefonoNormalizado = telefonoTutor.replace(/^521(\d{10})$/, '52$1');
  return db.transaction((trx) =>
    repository.registrarEchoManual(trx, {
      whatsappMessageId,
      telefonoTutor: telefonoNormalizado,
      phoneNumberId,
      tipoMensaje,
      recibidoEn,
    }),
  );
}

module.exports = {
  solicitarAtencionHumana,
  procesarSiguienteSolicitudPendiente,
  cerrarSiguienteAtencionHumanaVencida,
  registrarEchoManual,
  AtencionHumanaValidationError,
  TEXTO_TRANSFERENCIA,
  TEXTO_TRANSFERENCIA_POR_TIPO,
};
