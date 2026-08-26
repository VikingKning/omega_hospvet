// Job de polling para agenda.googleSync.js#sincronizar — pedido explícito
// del usuario: revisar Google Calendar cada 5-15 min (GOOGLE_SYNC_INTERVAL_MINUTES,
// default 10) para reflejar cancelaciones/reagendados hechos directo ahí.
// setInterval simple, no una librería de cron: es "cada N minutos fijo",
// no un schedule real. Primer directorio de jobs del proyecto.
const env = require('../config/env');
const logger = require('../config/logger');
const { isGoogleSyncConfigured } = require('../config/googleCalendar');
const { sincronizar } = require('../modules/agenda/agenda.googleSync');

// Nunca en NODE_ENV=test (mismo criterio que logger.js#isTest) — evita que
// Jest quede con un intervalo de fondo abierto que le impida terminar, y
// evita pegarle a la API real de Google durante una corrida de tests.
function start() {
  if (env.nodeEnv === 'test' || !isGoogleSyncConfigured()) {
    return null;
  }

  const intervalMs = env.google.syncIntervalMinutes * 60 * 1000;
  logger.info(
    `Sincronización con Google Calendar activa, cada ${env.google.syncIntervalMinutes} min.`,
  );

  return setInterval(() => {
    sincronizar().catch((err) => {
      logger.error({ err }, 'Falló un ciclo de sincronización con Google Calendar.');
    });
  }, intervalMs);
}

module.exports = { start };
