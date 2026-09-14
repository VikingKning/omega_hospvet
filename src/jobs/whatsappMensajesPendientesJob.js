// Job de recuperación para whatsapp.service.js#procesarMensajePendiente
// (US WA 001) — red de seguridad para mensajes que quedaron 'pendiente' (o
// 'procesando' huérfano) tras un reinicio de PM2, o un disparo inmediato
// del webhook que se perdió. setInterval simple, mismo patrón que
// plantillasWhatsappMetaSyncJob.js/googleCalendarSyncJob.js — pero en
// SEGUNDOS, no minutos: esto es chat casi en tiempo real, no una
// sincronización de catálogo.
const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const repository = require('../modules/whatsapp/whatsapp.repository');
const service = require('../modules/whatsapp/whatsapp.service');

async function revisarPendientes() {
  const ids = await repository.findPendientesParaProcesar({
    minutosHuerfano: env.whatsapp.workerStaleMinutes,
  });
  for (const id of ids) {
    await service.procesarMensajePendiente(id).catch((err) => {
      logger.error(
        { err, mensajeId: id },
        'Falló el reprocesamiento de un mensaje de WhatsApp pendiente.',
      );
    });
  }
}

// Nunca en NODE_ENV=test (mismo criterio que los otros 2 jobs): evita un
// intervalo de fondo que le impida a Jest terminar, y evita pegarle a la
// API real de Claude/Meta durante una corrida de tests.
function start() {
  if (env.nodeEnv === 'test' || !isWhatsappConfigured()) {
    return null;
  }

  const intervalMs = env.whatsapp.workerPollIntervalSeconds * 1000;
  logger.info(
    `Recuperación de mensajes de WhatsApp pendientes activa, cada ${env.whatsapp.workerPollIntervalSeconds}s.`,
  );

  return setInterval(() => {
    revisarPendientes().catch((err) => {
      logger.error({ err }, 'Falló un ciclo de recuperación de mensajes de WhatsApp pendientes.');
    });
  }, intervalMs);
}

module.exports = { start, revisarPendientes };
