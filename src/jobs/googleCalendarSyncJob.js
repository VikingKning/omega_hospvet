const env = require('../config/env');
const logger = require('../config/logger');
const { isGoogleSyncConfigured } = require('../config/googleCalendar');
const { sincronizar } = require('../modules/agenda/agenda.googleSync');

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
