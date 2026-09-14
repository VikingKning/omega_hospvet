// US WA 015: orquestación de envíos salientes idempotentes — tercer
// concern distinto de whatsapp.service.js (pipeline de mensajes
// ENTRANTES) y whatsapp.envios.js (envío proactivo específico de
// laboratorio): esta capa es genérica para cualquier tipo de envío
// saliente (conversacional, laboratorio, alerta_interna) y no sabe nada
// de clasificación ni de construir contenido — solo registra una
// intención YA decidida (AC4) y la ejecuta de forma segura ante
// reintentos.
const whatsapp = require('../../config/whatsapp');
const logger = require('../../config/logger');
const repository = require('./whatsapp.repository');

// Arma el body exacto de Meta a partir del contenido YA decidido — nunca
// reconstruye ni reclasifica nada (AC4).
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
    // US WA 004: reenvía tal cual el `interactive` ya armado por
    // whatsapp.menu.js — mismo criterio de "nunca reconstruir" que
    // 'template'/'texto'.
    return {
      messaging_product: 'whatsapp',
      to: payload.destinatarioTelefono,
      type: 'interactive',
      interactive: payload.interactive,
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

// AC1: registra la intención ANTES de que se intente enviar.
async function registrarIntento(datos) {
  return repository.registrarIntentoEnvio(datos);
}

// AC2/AC3/AC4/AC5: ejecuta (o reutiliza) UN intento ya registrado. Siempre
// relee la fila fresca de BD — nunca recibe el intento como parámetro en
// memoria, para no arrastrar un estado potencialmente obsoleto entre
// reintentos.
async function ejecutarIntento(claveIdempotencia) {
  const intent = await repository.buscarIntentoPorClave(claveIdempotencia);
  if (!intent) {
    throw new Error(`No existe una intención de envío con clave "${claveIdempotencia}".`);
  }

  if (intent.estado === 'enviado') {
    return { enviado: true, yaEnviado: true, wamid: intent.wamid };
  }

  // AC2: Meta ya aceptó el mensaje en un intento anterior y el proceso se
  // cayó antes de terminar la operación local — se finaliza SIN volver a
  // llamar a Meta.
  if (intent.wamid) {
    await repository.marcarResultadoEnvio(intent.intent_id, { estado: 'enviado' });
    return { enviado: true, yaEnviado: true, wamid: intent.wamid };
  }

  // AC5: solo los envíos conversacionales están sujetos a la ventana de
  // servicio de 24h — Meta permite plantillas aprobadas (laboratorio,
  // AC6) fuera de ella.
  if (intent.tipo_envio === 'conversacional' && intent.conversacion_id) {
    const vencida = await repository.estaVentanaServicioVencida(intent.conversacion_id);
    if (vencida) {
      await repository.marcarResultadoEnvio(intent.intent_id, {
        estado: 'ventana_servicio_expirada',
      });
      return { enviado: false, motivo: 'ventana_servicio_expirada' };
    }
  }

  await repository.incrementarIntento(intent.intent_id);

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
  await repository.marcarWamid(intent.intent_id, wamid);
  await repository.marcarResultadoEnvio(intent.intent_id, { estado: 'enviado' });
  return { enviado: true, wamid };
}

// AC3: aplicado por whatsapp.controller.js#recibir para cada webhook de
// estado — nunca truena el webhook completo si el wamid no corresponde a
// ningún intento local (solo se advierte).
async function registrarEstadoMeta({ wamid, estadoMeta }) {
  const encontrado = await repository.aplicarEstadoMeta(wamid, estadoMeta);
  if (!encontrado) {
    logger.warn(
      { wamid, estadoMeta },
      'Webhook de estado de WhatsApp sin outbox_whatsapp correspondiente.',
    );
  }
}

module.exports = { registrarIntento, ejecutarIntento, registrarEstadoMeta };
