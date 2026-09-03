require('dotenv').config({ quiet: true });

const required = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'SESSION_SECRET',
  'LABS_RESULT_FILE_STORAGE',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Falta la variable de entorno requerida: ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET,
  // Carpeta donde se guardan los archivos de resultados de laboratorio
  // (laboratorio.archivos.js) — pedido explícito del usuario: antes vivía
  // fija dentro del proyecto (`storage/laboratorio/`), ahora cada entorno
  // decide su propia ruta (puede ser fuera del repo por completo). Sigue
  // sin servirse nunca por static serving directo, sin importar dónde
  // apunte esta variable.
  labsResultFileStorage: process.env.LABS_RESULT_FILE_STORAGE,
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
  // Envío de resultados de laboratorio por WhatsApp (Decisión 21) —
  // opcionales a propósito, mismo criterio que `google` arriba: sin ellas
  // la app sigue funcionando normal, el envío por WhatsApp simplemente no
  // se activa (ver isWhatsappConfigured() en config/whatsapp.js). Hoy
  // apunta al número de PRUEBA de Meta (decisión explícita del usuario,
  // mientras la app de Meta sigue en modo Desarrollo) — cuando se dé de
  // alta el número real, solo cambia WHATSAPP_PHONE_NUMBER_ID.
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    // Webhook de mensajes entrantes (módulo `whatsapp/`) — appSecret firma
    // cada POST que manda Meta (X-Hub-Signature-256), webhookVerifyToken es
    // un valor que NOSOTROS elegimos y se pega tal cual en el campo
    // "Verify token" al registrar el webhook en Meta (no lo genera Meta).
    appSecret: process.env.WHATSAPP_APP_SECRET,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  },
  // Clasificador de intención de WhatsApp (Bitácora de Decisiones Técnicas
  // v4: "claude-haiku-4-5 vía Claude API, Commercial Terms — solo
  // clasifica, nunca genera contenido médico libre") — opcional, mismo
  // criterio que `google`/`whatsapp` arriba (ver isClaudeConfigured() en
  // config/claude.js).
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
};
