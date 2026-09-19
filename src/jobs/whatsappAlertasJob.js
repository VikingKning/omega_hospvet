const env = require('../config/env');
const logger = require('../config/logger');
const service = require('../modules/whatsapp/whatsapp.alertas.service');

let cicloEnCurso = false;

async function enviarAlertasPendientes() {
  let resultado;
  do {
    resultado = await service.procesarSiguienteAlertaPendiente();
  } while (resultado !== null);
}

function start() {
  if (env.nodeEnv === 'test') return null;
  const intervalMs = env.whatsapp.atencionHumanaPollIntervalSeconds * 1000;
  logger.info(`Alertas internas activas, cada ${env.whatsapp.atencionHumanaPollIntervalSeconds}s.`);
  return setInterval(async () => {
    if (cicloEnCurso) return;
    cicloEnCurso = true;
    try {
      await enviarAlertasPendientes();
    } catch (err) {
      logger.error({ err }, 'Falló un ciclo de alertas internas de WhatsApp.');
    } finally {
      cicloEnCurso = false;
    }
  }, intervalMs);
}

module.exports = { start, enviarAlertasPendientes };
