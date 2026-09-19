const { google } = require('googleapis');
const env = require('./env');

function isGoogleSyncConfigured() {
  const { clientId, clientSecret, refreshToken, calendarId } = env.google;
  return Boolean(clientId && clientSecret && refreshToken && calendarId);
}

let cachedClient = null;

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
