// US WA 017: mecanismo ÚNICO de transferencia temporal de una conversación
// al personal de Omega — cualquier flujo autorizado (US WA 009 para
// Emergencia, una historia futura para Recepción) llama a
// solicitarAtencionHumana() en vez de implementar su propio ciclo de
// estados/mensajes/vencimiento (AC23/consideración técnica). Esta historia
// NO decide cuándo llamar a esa función (eso lo decide cada origen, fuera
// de este módulo) — solo construye el mecanismo compartido.
const db = require('../../config/database');
const logger = require('../../config/logger');
const repository = require('./whatsapp.atencionHumana.repository');
const outbox = require('./whatsapp.outbox');

// AC3/AC4: texto EXACTO dado por la historia (no es una asunción de
// contenido, a diferencia del resto de textos de este módulo) — nunca
// menciona información clínica, categorías internas, prioridades ni
// detalles de auditoría, y es el MISMO para Emergencia y Recepción
// (consideración técnica).
const TEXTO_TRANSFERENCIA =
  'Tu conversación ha sido canalizada al personal de Omega para que continúe con la atención. ' +
  'A partir de este momento, el asistente dejará de responder temporalmente.';

// Consideración técnica: "Permitir inicialmente los orígenes controlados
// emergencia y recepcion, sin utilizar texto libre para decidir el
// comportamiento" — whitelist real, nunca se confía en lo que mande el
// llamador.
const ORIGENES_VALIDOS = ['emergencia', 'recepcion'];

class AtencionHumanaValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function claveOutboxTransferencia(solicitudId) {
  return `atencion_humana:${solicitudId}:transferencia`;
}

// AC1/AC2/AC3: registra la solicitud (idempotente por clave_idempotencia,
// construida por el LLAMADOR a partir de una referencia estable de
// origen+conversación+evento — consideración técnica) y, solo si resultó
// nueva, registra de inmediato la intención de envío del aviso genérico
// vía US WA 015 (AC3: "cuando se prepara la transferencia... registra...
// una intención de envío"). El ENVÍO real (llamar a Meta) lo hace el
// worker (procesarSiguienteSolicitudPendiente), nunca esta función — AC5
// exige respetar el orden de envio_previo, algo que solo se puede
// comprobar en el momento de intentar enviar, no al solicitar.
// `trx` opcional (US WA 009 AC23): permite que el origen que solicita (ej.
// la clasificación atómica de un grupo de emergencia) componga TODO este
// registro dentro de su propia transacción, junto con sus propias
// escrituras — omitido, se comporta exactamente igual que antes de esa
// historia (2 escrituras sueltas contra `db`).
async function solicitarAtencionHumana({
  conversacionId,
  origen,
  prioridad,
  claveIdempotencia,
  referenciasFuncionales,
  envioPrevioId,
  destinatarioTelefono,
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

  // Solicitud + intención de outbox forman una sola unidad. Así un reinicio
  // nunca puede dejar una solicitud existente sin el mensaje que debe
  // ejecutar, y una reentrega puede reutilizar ambos registros.
  if (!trx) {
    return db.transaction((transaccion) =>
      solicitarAtencionHumana({
        conversacionId,
        origen,
        prioridad,
        claveIdempotencia,
        referenciasFuncionales,
        envioPrevioId,
        destinatarioTelefono,
        ahora,
        trx: transaccion,
      }),
    );
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
    // AC2: reutiliza el registro existente — ni siquiera se vuelve a
    // registrar la intención de envío (ya se hizo la primera vez).
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
        texto: TEXTO_TRANSFERENCIA,
      },
      usaPlantilla: false,
    },
    trx,
  );
  await repository.marcarSolicitudOutbox(solicitud.id, intent.intent_id, trx);

  return { ...solicitud, outbox_id: intent.intent_id };
}

// AC5/AC6/AC19/AC22: reclama UNA solicitud lista para enviar (o reintentar)
// — reclamarSolicitudPendiente ya resuelve el orden de envio_previo (AC5,
// regresa null si el previo todavía no se confirma, sin marcar ningún
// fallo) y el bloqueo de fila (AC22). Ejecuta el intent YA registrado por
// solicitarAtencionHumana (nunca lo reconstruye) y, según el resultado,
// confirma la transferencia (AC6) o deja la solicitud reintentable (AC19).
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
    // AC19: Meta rechazó el envío (o la ventana de servicio expiró) —
    // conserva la intención para reintento idempotente, sin tocar
    // atencion_humana_desde/hasta.
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

  // AC6: fecha efectiva del envío = ahora (el momento en que Meta lo
  // confirmó), no solicitud.solicitado_en.
  const confirmada = await repository.confirmarTransferenciaEnviada(solicitud.id, {
    conversacionId: solicitud.conversacion_id,
    ahora: new Date(),
  });
  if (!confirmada) {
    // Transición no permitida (ej. la conversación ya se cerró por otra
    // vía mientras se enviaba) — el mensaje YA salió a Meta, así que no se
    // reintenta; se deja auditado como enviado sin transición.
    logger.warn(
      { solicitudId: solicitud.id, conversacionId: solicitud.conversacion_id },
      'Aviso de transferencia enviado, pero la conversación ya no admite pasar a atencion_humana.',
    );
  }

  return { id: solicitud.id, resultado: 'enviada' };
}

// AC15/AC22: cierra UNA conversación cuya atención humana ya venció según
// el reloj de PostgreSQL.
async function cerrarSiguienteAtencionHumanaVencida() {
  return repository.reclamarAtencionHumanaVencida();
}

// AC25-AC31/AC35/AC36: un mensaje manual enviado por el personal desde la
// app/dispositivos vinculados de WhatsApp Business de Omega
// (smb_message_echoes). Se envuelve aquí en su PROPIA transacción — a
// diferencia del resto de este módulo, este evento no comparte
// transacción con ningún flujo de mensajes entrantes del tutor (son 2
// eventos de webhook completamente independientes).
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
};
