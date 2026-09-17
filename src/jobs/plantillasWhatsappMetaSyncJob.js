const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const {
  revisarAprobaciones,
} = require('../modules/plantillas_whatsapp/plantillas_whatsapp.metaSync');

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
