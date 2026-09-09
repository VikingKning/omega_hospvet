// Cliente de WhatsApp Business Cloud API (envío de resultados de
// laboratorio, Decisión 21) — llamadas HTTP directas a la Graph API vía
// `fetch` nativo de Node (sin SDK de por medio, mismo criterio de "no
// agregar una dependencia para lo que ya trae el runtime" del resto del
// proyecto). Un solo número de WhatsApp Business para toda la clínica
// (decisión explícita del usuario, mismo criterio que la cuenta única de
// Google Calendar).
const crypto = require('crypto');
const env = require('./env');

const GRAPH_API_VERSION = 'v23.0';

function isWhatsappConfigured() {
  const { token, phoneNumberId } = env.whatsapp;
  return Boolean(token && phoneNumberId);
}

// URL del endpoint de envío para el número configurado — el mismo para
// mensajes de plantilla y de texto libre, solo cambia el body.
function messagesUrl() {
  if (!isWhatsappConfigured()) {
    throw new Error('WhatsApp no está configurado (faltan variables de entorno).');
  }
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.whatsapp.phoneNumberId}/messages`;
}

// Alta/consulta de Plantillas de Mensaje (Meta Message Templates) — vive a
// nivel de la CUENTA de negocio (WABA), no del número, a diferencia de
// messagesUrl() de arriba.
function templatesUrl() {
  const { token, businessAccountId } = env.whatsapp;
  if (!token || !businessAccountId) {
    throw new Error(
      'WhatsApp no está configurado para plantillas (falta WHATSAPP_BUSINESS_ACCOUNT_ID).',
    );
  }
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${businessAccountId}/message_templates`;
}

// Subida de media (envío de resultados de laboratorio, whatsapp.envios.js)
// — vive a nivel del NÚMERO, igual que messagesUrl(): se sube el archivo
// aquí primero para obtener un media id, y ESE id (no el archivo) es lo
// que se manda como parámetro del header de una plantilla.
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

// Solo el Authorization — para requests multipart (mediaUrl() de arriba)
// fetch arma su propio 'Content-Type: multipart/form-data; boundary=...' a
// partir del FormData; fijarlo a mano (como hace authHeaders()) rompe el
// boundary y Meta rechaza la subida.
function bearerHeader() {
  return { Authorization: `Bearer ${env.whatsapp.token}` };
}

// Verifica que un POST del webhook realmente venga de Meta — recalcula el
// HMAC-SHA256 sobre el body CRUDO (nunca el ya parseado a JSON, el HMAC no
// coincidiría) con el App Secret, y lo compara contra el header
// `X-Hub-Signature-256: sha256=<hex>` que manda Meta. `timingSafeEqual` en
// vez de `===`: comparar cadenas con `===` sale más rápido mientras antes
// difieran, filtrando por temporización cuánto del hash acertó un
// atacante — mismo cuidado que ya aplica el resto del proyecto en
// comparaciones de contraseña/token.
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

// Handshake GET del webhook (whatsapp.controller.js#verificar) — el valor
// lo elegimos nosotros (ver env.js), Meta solo lo repite tal cual lo
// configuramos en su consola.
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
