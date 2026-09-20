const whatsapp = require('../../config/whatsapp');
const logger = require('../../config/logger');
const repository = require('./whatsapp.repository');

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

  if (intent.tipo_envio === 'conversacional' && intent.conversacion_id) {
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
    await repository.marcarResultadoEnvio(intent.intent_id, {
      estado: 'fallido',
      ultimoError: mensaje,
    });
    return {
      enviado: false,
      error: mensaje,
      errorCodigo: data.error?.code ? String(data.error.code) : null,
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
