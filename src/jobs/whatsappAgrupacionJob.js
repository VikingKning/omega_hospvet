const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const service = require('../modules/whatsapp/whatsapp.service');
let cicloEnCurso = false;

async function revisarConversacionesVencidas() {
  let resultado;
  do {
    resultado = await service.procesarSiguienteConversacionVencida();
  } while (resultado !== null);
}

function start() {
  if (env.nodeEnv === 'test' || !isWhatsappConfigured()) {
    return null;
  }

  const intervalMs = env.whatsapp.agrupacionPollIntervalSeconds * 1000;
  logger.info(
    `Agrupación de mensajes de WhatsApp por ventana de inactividad activa, cada ${env.whatsapp.agrupacionPollIntervalSeconds}s.`,
  );

  return setInterval(async () => {
    if (cicloEnCurso) return;
    cicloEnCurso = true;
    try {
      await revisarConversacionesVencidas();
    } catch (err) {
      logger.error({ err }, 'Falló un ciclo de agrupación de conversaciones de WhatsApp vencidas.');
    } finally {
      cicloEnCurso = false;
    }
  }, intervalMs);
}

module.exports = { start, revisarConversacionesVencidas };
