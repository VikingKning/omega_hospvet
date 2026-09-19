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
  operationalTimezone: process.env.OMEGA_TIMEZONE || 'America/Mexico_City',
  sessionSecret: process.env.SESSION_SECRET,
  labsResultFileStorage: process.env.LABS_RESULT_FILE_STORAGE,
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    syncIntervalMinutes: Number(process.env.GOOGLE_SYNC_INTERVAL_MINUTES) || 10,
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appId: process.env.WHATSAPP_APP_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    templatesSyncIntervalMinutes:
      Number(process.env.WHATSAPP_TEMPLATES_SYNC_INTERVAL_MINUTES) || 60,
    agrupacionSegundos: Number(process.env.WHATSAPP_AGRUPACION_SEGUNDOS) || 10,
    agrupacionEmergenciaSegundos:
      Number(process.env.WHATSAPP_AGRUPACION_EMERGENCIA_SEGUNDOS) ||
      Number(process.env.WHATSAPP_AGRUPACION_SEGUNDOS) ||
      10,
    agrupacionPollIntervalSeconds:
      Number(process.env.WHATSAPP_AGRUPACION_POLL_INTERVAL_SEGUNDOS) || 3,
    agrupacionReclamoHuerfanoMinutos:
      Number(process.env.WHATSAPP_AGRUPACION_RECLAMO_HUERFANO_MINUTOS) || 2,
    flujoRecordatorioMinutos: Number(process.env.WHATSAPP_FLUJO_RECORDATORIO_MINUTOS) || 10,
    flujoCierreAdicionalMinutos: Number(process.env.WHATSAPP_FLUJO_CIERRE_ADICIONAL_MINUTOS) || 20,
    labMaxIntentos: Number(process.env.WHATSAPP_LAB_MAX_INTENTOS) || 3,
    atencionHumanaHoras: Number(process.env.WHATSAPP_ATENCION_HUMANA_HORAS) || 5,
    atencionHumanaPollIntervalSeconds:
      Number(process.env.WHATSAPP_ATENCION_HUMANA_POLL_INTERVAL_SEGUNDOS) || 5,
    workerReclamoHuerfanoSegundos:
      Number(process.env.WHATSAPP_WORKER_RECLAMO_HUERFANO_SEGUNDOS) || 120,
    atencionHumanaReintentoSegundos:
      Number(process.env.WHATSAPP_ATENCION_HUMANA_REINTENTO_SEGUNDOS) || 30,
    conversationalRouterEnabled: !['false', '0', 'no', 'off'].includes(
      String(process.env.WHATSAPP_CONVERSATIONAL_ROUTER_ENABLED ?? 'true').toLowerCase(),
    ),
    legacyPollIntervalSeconds: Number(process.env.WHATSAPP_LEGACY_POLL_INTERVAL_SEGUNDOS) || 5,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS) || 10000,
  },
  email: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  },
  enlaces: {
    calendarioCitas: process.env.GOOGLE_CALENDAR_MEETING_URL,
    calendarioEstetica: process.env.GOOGLE_CALENDAR_GROOMING,
    ubicacionMaps: process.env.GOOGLE_MAPS_URL,
  },
};
