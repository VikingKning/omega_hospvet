// Cliente de WhatsApp Business Cloud API (envío de resultados de
// laboratorio, Decisión 21) — llamadas HTTP directas a la Graph API vía
// `fetch` nativo de Node (sin SDK de por medio, mismo criterio de "no
// agregar una dependencia para lo que ya trae el runtime" del resto del
// proyecto). Un solo número de WhatsApp Business para toda la clínica
// (decisión explícita del usuario, mismo criterio que la cuenta única de
// Google Calendar).
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

function authHeaders() {
  return {
    Authorization: `Bearer ${env.whatsapp.token}`,
    'Content-Type': 'application/json',
  };
}

module.exports = {
  isWhatsappConfigured,
  messagesUrl,
  templatesUrl,
  authHeaders,
  GRAPH_API_VERSION,
};
