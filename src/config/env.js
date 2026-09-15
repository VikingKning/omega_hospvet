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
    // Solo la usa scripts/registrar-plantilla-resultados-laboratorio.js
    // (Resumable Upload API de Meta, POST /{appId}/uploads) — el ID de la
    // app de Meta for Developers, distinto de businessAccountId/
    // phoneNumberId. No hace falta para nada del resto del envío/recepción
    // normal de mensajes.
    appId: process.env.WHATSAPP_APP_ID,
    // Webhook de mensajes entrantes (módulo `whatsapp/`) — appSecret firma
    // cada POST que manda Meta (X-Hub-Signature-256), webhookVerifyToken es
    // un valor que NOSOTROS elegimos y se pega tal cual en el campo
    // "Verify token" al registrar el webhook en Meta (no lo genera Meta).
    appSecret: process.env.WHATSAPP_APP_SECRET,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    // Job periódico que revisa si Meta ya aprobó cada plantilla pendiente
    // (plantillas_whatsapp.metaSync.js) — la revisión de Meta tarda
    // típicamente horas, no minutos, así que el default es más
    // espaciado que el de Google Calendar (GOOGLE_SYNC_INTERVAL_MINUTES).
    templatesSyncIntervalMinutes:
      Number(process.env.WHATSAPP_TEMPLATES_SYNC_INTERVAL_MINUTES) || 60,
    // US WA 003: duración de la ventana de agrupación de mensajes
    // (AC1/AC2/AC3) — pedido explícito de la consideración técnica.
    agrupacionSegundos: Number(process.env.WHATSAPP_AGRUPACION_SEGUNDOS) || 10,
    // Ventana de inactividad para la descripción de una emergencia. En
    // pruebas reales, 3s cortaban frases antes de que el tutor terminara;
    // por defecto usa la misma ventana de 10s del flujo normal.
    agrupacionEmergenciaSegundos:
      Number(process.env.WHATSAPP_AGRUPACION_EMERGENCIA_SEGUNDOS) ||
      Number(process.env.WHATSAPP_AGRUPACION_SEGUNDOS) ||
      10,
    // Cada cuántos segundos whatsappAgrupacionJob.js revisa conversaciones
    // vencidas — corto a propósito (el objetivo es cerrar la ventana de
    // 10s casi en tiempo real, no cada 30s como el poller retirado de
    // mensajes individuales).
    agrupacionPollIntervalSeconds:
      Number(process.env.WHATSAPP_AGRUPACION_POLL_INTERVAL_SEGUNDOS) || 3,
    // A partir de cuántos minutos una conversación 'procesando' se
    // considera abandonada por un worker interrumpido (AC13). Formar un
    // grupo debería tardar milisegundos, así que unos minutos ya es señal
    // clara de crash.
    agrupacionReclamoHuerfanoMinutos:
      Number(process.env.WHATSAPP_AGRUPACION_RECLAMO_HUERFANO_MINUTOS) || 2,
    // US WA 013: minutos sin interacción del tutor (estado esperando_menu o
    // flujo_activo) antes de enviar la pregunta de seguimiento (AC1), y
    // minutos adicionales tras ese seguimiento antes de cerrar la
    // conversación (AC6) — 10 y 20 respectivamente, valores fijados por la
    // consideración técnica.
    flujoRecordatorioMinutos: Number(process.env.WHATSAPP_FLUJO_RECORDATORIO_MINUTOS) || 10,
    flujoCierreAdicionalMinutos: Number(process.env.WHATSAPP_FLUJO_CIERRE_ADICIONAL_MINUTOS) || 20,
    // US WA 007 (AC10, consideración técnica: "valor aprobado antes del
    // despliegue") — el default de 3 es una ASUNCIÓN provisional, sujeta a
    // confirmación de negocio antes de producción.
    labMaxIntentos: Number(process.env.WHATSAPP_LAB_MAX_INTENTOS) || 3,
    // US WA 017 (consideración técnica: "Configurar
    // WHATSAPP_ATENCION_HUMANA_HORAS con valor 5") — atencion_humana_hasta
    // se calcula UNA sola vez a partir de atencion_humana_desde (AC6/AC21);
    // mensajes posteriores nunca la extienden.
    atencionHumanaHoras: Number(process.env.WHATSAPP_ATENCION_HUMANA_HORAS) || 5,
    // Cada cuántos segundos whatsappAtencionHumanaJob.js envía transferencias
    // pendientes y cierra atenciones humanas vencidas — mismo orden de
    // magnitud que agrupacionPollIntervalSeconds (esto también debe sentirse
    // casi en tiempo real: un tutor no debe esperar minutos para enterarse
    // de que lo canalizaron a personal, ni seguir "congelado" en
    // atencion_humana mucho después de las 5 horas).
    atencionHumanaPollIntervalSeconds:
      Number(process.env.WHATSAPP_ATENCION_HUMANA_POLL_INTERVAL_SEGUNDOS) || 5,
    // Lease común para recuperar envíos, clasificaciones o transferencias
    // abandonadas por un proceso interrumpido.
    workerReclamoHuerfanoSegundos:
      Number(process.env.WHATSAPP_WORKER_RECLAMO_HUERFANO_SEGUNDOS) || 120,
    // Backoff persistente de transferencias fallidas: evita que el drain
    // loop reclame inmediatamente la misma fila una y otra vez.
    atencionHumanaReintentoSegundos:
      Number(process.env.WHATSAPP_ATENCION_HUMANA_REINTENTO_SEGUNDOS) || 30,
  },
  // Clasificador de intención de WhatsApp (Bitácora de Decisiones Técnicas
  // v4: "claude-haiku-4-5 vía Claude API, Commercial Terms — solo
  // clasifica, nunca genera contenido médico libre") — opcional, mismo
  // criterio que `google`/`whatsapp` arriba (ver isClaudeConfigured() en
  // config/claude.js).
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  // Envío de resultados de laboratorio por correo (config/email.js) —
  // opcional, mismo criterio que `google`/`whatsapp` arriba: sin ellas la
  // app sigue funcionando normal, el envío por correo simplemente no se
  // activa (ver isEmailConfigured()).
  email: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    // 'true'/'1' → true, cualquier otra cosa (incluido vacío/undefined) →
    // false — una env var siempre llega como string, nunca como boolean.
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  },
  // Links públicos que se mandan tal cual al cliente (correo/WhatsApp de
  // resultados de laboratorio) — pedido explícito del usuario: que apuntar
  // a un calendario o mapa distinto sea cambiar una variable de entorno,
  // nunca tocar código. Distinto de `google.calendarId` de arriba (ese es
  // el calendario interno con el que se sincroniza la agenda vía OAuth,
  // este es un link público de agendar cita que ve el cliente).
  enlaces: {
    calendarioCitas: process.env.GOOGLE_CALENDAR_MEETING_URL,
    ubicacionMaps: process.env.GOOGLE_MAPS_URL,
  },
};
