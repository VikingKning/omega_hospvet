const crypto = require('crypto');
const env = require('./env');

const GRAPH_API_VERSION = 'v23.0';

function isWhatsappConfigured() {
  const { token, phoneNumberId } = env.whatsapp;
  return Boolean(token && phoneNumberId);
}

function messagesUrl() {
  if (!isWhatsappConfigured()) {
    throw new Error('WhatsApp no está configurado (faltan variables de entorno).');
  }
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.whatsapp.phoneNumberId}/messages`;
}

function templatesUrl() {
  const { token, businessAccountId } = env.whatsapp;
  if (!token || !businessAccountId) {
    throw new Error(
      'WhatsApp no está configurado para plantillas (falta WHATSAPP_BUSINESS_ACCOUNT_ID).',
    );
  }
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${businessAccountId}/message_templates`;
}

function mediaUrl() {
  if (!isWhatsappConfigured()) {
    throw new Error('WhatsApp no está configurado (faltan variables de entorno).');
  }
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.whatsapp.phoneNumberId}/media`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${env.whatsapp.token}`,
    'Content-Type': 'application/json',
  };
}

function bearerHeader() {
  return { Authorization: `Bearer ${env.whatsapp.token}` };
}

function verificarFirma(rawBody, signatureHeader) {
  if (!env.whatsapp.appSecret || !signatureHeader?.startsWith('sha256=')) return false;

  const esperada = crypto
    .createHmac('sha256', env.whatsapp.appSecret)
    .update(rawBody)
    .digest('hex');
  const recibida = signatureHeader.slice('sha256='.length);

  const bufEsperada = Buffer.from(esperada, 'hex');
  const bufRecibida = Buffer.from(recibida, 'hex');
  if (bufEsperada.length !== bufRecibida.length) return false;
  return crypto.timingSafeEqual(bufEsperada, bufRecibida);
}

function esVerifyTokenValido(token) {
  return Boolean(env.whatsapp.webhookVerifyToken) && token === env.whatsapp.webhookVerifyToken;
}

module.exports = {
  isWhatsappConfigured,
  messagesUrl,
  templatesUrl,
  mediaUrl,
  authHeaders,
  bearerHeader,
  verificarFirma,
  esVerifyTokenValido,
  GRAPH_API_VERSION,
};
