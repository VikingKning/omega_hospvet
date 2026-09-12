// Job de polling para plantillas_whatsapp.metaSync.js#revisarAprobaciones
// — revisa cada cierto tiempo (WHATSAPP_TEMPLATES_SYNC_INTERVAL_MINUTES,
// default 60) el estado y la categoría reales informados por Meta.
// setInterval simple, mismo patrón que
// googleCalendarSyncJob.js.
const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const {
  revisarAprobaciones,
} = require('../modules/plantillas_whatsapp/plantillas_whatsapp.metaSync');

// Nunca en NODE_ENV=test (mismo criterio que googleCalendarSyncJob.js):
// evita un intervalo de fondo que le impida a Jest terminar, y evita
// pegarle a la API real de Meta durante una corrida de tests.
function start() {
  if (env.nodeEnv === 'test' || !isWhatsappConfigured()) {
    return null;
  }

  const intervalMs = env.whatsapp.templatesSyncIntervalMinutes * 60 * 1000;
  logger.info(
    `Sincronización de plantillas de WhatsApp con Meta activa, cada ${env.whatsapp.templatesSyncIntervalMinutes} min.`,
  );

  return setInterval(() => {
    revisarAprobaciones().catch((err) => {
      logger.error(
        { err },
        'Falló un ciclo de revisión de aprobaciones de plantillas de WhatsApp.',
      );
    });
  }, intervalMs);
}

module.exports = { start };
