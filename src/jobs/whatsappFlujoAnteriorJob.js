const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const service = require('../modules/whatsapp/whatsapp.service');

let cicloEnCurso = false;

async function revisarMensajesPendientes() {
  let mensajeId;
  do {
    mensajeId = await service.procesarSiguienteMensajeFlujoAnterior();
  } while (mensajeId !== null);
}

function start() {
  if (env.nodeEnv === 'test' || !isWhatsappConfigured()) return null;
  const intervalMs = env.whatsapp.legacyPollIntervalSeconds * 1000;
  logger.info(
    { intervaloSegundos: env.whatsapp.legacyPollIntervalSeconds },
    'Worker exclusivo del flujo anterior de WhatsApp activo.',
  );
  return setInterval(async () => {
    if (cicloEnCurso) return;
    cicloEnCurso = true;
    try {
      await revisarMensajesPendientes();
    } catch (err) {
      logger.error({ err, pipeline: 'flujo_anterior' }, 'Falló un ciclo del flujo anterior.');
    } finally {
      cicloEnCurso = false;
    }
  }, intervalMs);
}

module.exports = { start, revisarMensajesPendientes };
