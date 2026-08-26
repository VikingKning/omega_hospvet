require('dotenv').config({ quiet: true });

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SESSION_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Falta la variable de entorno requerida: ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET,
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  // Sincronización con Google Calendar (agenda.googleSync.js) — opcionales
  // a propósito (nunca en `required` de arriba): sin ellas, la app entera
  // sigue funcionando normal, la sincronización simplemente no se activa
  // (ver isGoogleSyncConfigured() en config/googleCalendar.js). Una sola
  // cuenta/calendario para las 8 áreas (decisión explícita del usuario).
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    syncIntervalMinutes: Number(process.env.GOOGLE_SYNC_INTERVAL_MINUTES) || 10,
  },
};
