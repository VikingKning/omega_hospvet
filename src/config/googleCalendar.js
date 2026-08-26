// Cliente de Google Calendar (agenda.googleSync.js) — OAuth de una sola
// cuenta real (no cuenta de servicio, decisión explícita del usuario), con
// un refresh_token ya generado una sola vez a mano (ver README/memoria del
// proyecto). googleapis renueva el access_token sola con ese refresh_token,
// nunca hay que volver a pasar por el consentimiento.
const { google } = require('googleapis');
const env = require('./env');

function isGoogleSyncConfigured() {
  const { clientId, clientSecret, refreshToken, calendarId } = env.google;
  return Boolean(clientId && clientSecret && refreshToken && calendarId);
}

let cachedClient = null;

// Un solo cliente reutilizado entre llamadas (mismo criterio que `db` en
// database.js) — construirlo de más no cuesta caro, pero no hay razón para
// repetirlo en cada push/pull.
function getCalendarClient() {
  if (!isGoogleSyncConfigured()) {
    throw new Error('Google Calendar sync no está configurado (faltan variables de entorno).');
  }
  if (cachedClient) return cachedClient;

  const auth = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret);
  auth.setCredentials({ refresh_token: env.google.refreshToken });

  cachedClient = google.calendar({ version: 'v3', auth });
  return cachedClient;
}

module.exports = { getCalendarClient, isGoogleSyncConfigured };
