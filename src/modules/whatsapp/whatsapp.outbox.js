const whatsapp = require('../../config/whatsapp');
const logger = require('../../config/logger');
const repository = require('./whatsapp.repository');
const { diagnosticoMeta } = require('./whatsapp.errores');

function construirBody(payload) {
  if (payload.tipo === 'template') {
    return {
      messaging_product: 'whatsapp',
      to: payload.destinatarioTelefono,
      type: 'template',
      template: payload.plantilla,
    };
  }
  if (payload.tipo === 'interactive') {
    return {
      messaging_product: 'whatsapp',
      to: payload.destinatarioTelefono,
      type: 'interactive',
      interactive: payload.interactive,
    };
  }
  if (payload.tipo === 'document') {
    return {
      messaging_product: 'whatsapp',
      to: payload.destinatarioTelefono,
      type: 'document',
      document: payload.document,
    };
  }
  if (payload.tipo === 'image') {
    return {
      messaging_product: 'whatsapp',
      to: payload.destinatarioTelefono,
      type: 'image',
      image: payload.image,
    };
  }
  return {
    messaging_product: 'whatsapp',
    to: payload.destinatarioTelefono,
    type: 'text',
    text: { body: payload.texto },
  };
}

async function enviarAMeta(payload) {
  const body = construirBody(payload);
  const res = await fetch(whatsapp.messagesUrl(), {
    method: 'POST',
    headers: whatsapp.authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  return { res, data };
}

async function registrarIntento(datos, trx) {
  return repository.registrarIntentoEnvio(datos, trx);
}

async function ejecutarIntento(claveIdempotencia) {
  const { intent, reclamado } = await repository.reclamarIntentoEnvio(claveIdempotencia);
  if (!intent) {
    throw new Error(`No existe una intención de envío con clave "${claveIdempotencia}".`);
  }

  if (intent.estado === 'enviado') {
    return { enviado: true, yaEnviado: true, wamid: intent.wamid };
  }

  if (intent.estado === 'cancelado') {
    return { enviado: false, motivo: 'cancelado' };
  }

  if (intent.estado === 'ventana_servicio_expirada') {
    return { enviado: false, motivo: 'ventana_servicio_expirada' };
  }

  if (intent.wamid) {
    await repository.marcarResultadoEnvio(intent.intent_id, { estado: 'enviado' });
    return { enviado: true, yaEnviado: true, wamid: intent.wamid };
  }

  if (!reclamado) {
    return { enviado: false, motivo: 'envio_en_progreso' };
  }

  const esArchivoLaboratorio =
    intent.origen_funcional === 'laboratorio' &&
    ['document', 'image'].includes(intent.payload_funcional?.tipo) &&
    intent.payload_funcional?.finalidad === 'resultados_laboratorio';
  if (esArchivoLaboratorio) {
    const ventana = await repository.buscarVentanaServicioCliente(
      intent.destinatario_telefono,
      intent.conversacion_id,
    );
    if (!ventana) {
      await repository.marcarResultadoEnvio(intent.intent_id, {
        estado: 'ventana_servicio_expirada',
      });
      return { enviado: false, motivo: 'ventana_servicio_expirada' };
    }
  } else if (intent.tipo_envio === 'conversacional' && intent.conversacion_id) {
    const vencida = await repository.estaVentanaServicioVencida(intent.conversacion_id);
    if (vencida) {
      await repository.marcarResultadoEnvio(intent.intent_id, {
        estado: 'ventana_servicio_expirada',
      });
      return { enviado: false, motivo: 'ventana_servicio_expirada' };
    }
  }

  let res;
  let data;
  // Comprobación final: una clasificación puede haber terminado después de
  // que el tutor eligiera Recepción. Los avisos de transferencia y alertas
  // conservan su propia ruta de envío.
  if (
    intent.tipo_envio === 'conversacional' &&
    intent.origen_funcional === 'respuesta_automatica' &&
    intent.conversacion_id &&
    (await repository.tieneRecepcionPrioritaria(intent.conversacion_id))
  ) {
    await repository.marcarResultadoEnvio(intent.intent_id, {
      estado: 'cancelado',
      ultimoError: 'Interrumpido por selección de Recepción.',
    });
    return { enviado: false, motivo: 'recepcion_prioritaria' };
  }
  try {
    ({ res, data } = await enviarAMeta(intent.payload_funcional));
  } catch (err) {
    await repository.marcarResultadoEnvio(intent.intent_id, {
      estado: 'fallido',
      ultimoError: err.message,
    });
    throw err;
  }

  if (!res.ok) {
    const mensaje = data.error?.message || `Meta rechazó el envío (HTTP ${res.status}).`;
    const diagnostico = diagnosticoMeta(res, data);
    await repository.marcarResultadoEnvio(intent.intent_id, {
      estado: 'fallido',
      ultimoError: mensaje,
    });
    logger.warn(
      {
        intentId: intent.intent_id,
        conversacionId: intent.conversacion_id,
        diagnosticoMeta: diagnostico,
      },
      'Meta rechazo el envio de WhatsApp.',
    );
    return {
      enviado: false,
      error: mensaje,
      errorCodigo: data.error?.code ? String(data.error.code) : null,
      diagnosticoMeta: diagnostico,
    };
  }

  const wamid = data.messages?.[0]?.id ?? null;
  // El wamid se persiste primero para reconocer reintentos tras una interrupción parcial.
  await repository.marcarWamid(intent.intent_id, wamid);
  await repository.marcarResultadoEnvio(intent.intent_id, { estado: 'enviado' });
  return { enviado: true, wamid };
}

async function registrarEstadoMeta({ wamid, estadoMeta }) {
  await repository.registrarEventoMetrica({
    claveEvento: `estado_meta:${wamid}:${estadoMeta}`,
    tipoEvento: 'estado_meta',
    resultado: estadoMeta,
  });
  const encontrado = await repository.aplicarEstadoMeta(wamid, estadoMeta);
  if (!encontrado) {
    logger.warn(
      { wamid, estadoMeta },
      'Webhook de estado de WhatsApp sin outbox_whatsapp correspondiente.',
    );
  }
}

module.exports = { registrarIntento, ejecutarIntento, registrarEstadoMeta };
