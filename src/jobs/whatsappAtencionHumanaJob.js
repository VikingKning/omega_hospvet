const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const service = require('../modules/whatsapp/whatsapp.atencionHumana.service');
let cicloEnCurso = false;

async function enviarTransferenciasPendientes() {
  let resultado;
  do {
    resultado = await service.procesarSiguienteSolicitudPendiente();
  } while (resultado !== null);
}

async function cerrarAtencionesHumanasVencidas() {
  let resultado;
  do {
    resultado = await service.cerrarSiguienteAtencionHumanaVencida();
  } while (resultado !== null);
}

function start() {
  if (env.nodeEnv === 'test' || !isWhatsappConfigured()) {
    return null;
  }

  const intervalMs = env.whatsapp.atencionHumanaPollIntervalSeconds * 1000;
  logger.info(
    `Atención humana de WhatsApp (transferencias y vencimientos) activa, cada ${env.whatsapp.atencionHumanaPollIntervalSeconds}s.`,
  );

  return setInterval(async () => {
    if (cicloEnCurso) return;
    cicloEnCurso = true;
    try {
      await enviarTransferenciasPendientes();
      await cerrarAtencionesHumanasVencidas();
    } catch (err) {
      logger.error({ err }, 'Falló un ciclo de atención humana de WhatsApp.');
    } finally {
      cicloEnCurso = false;
    }
  }, intervalMs);
}

module.exports = { start, enviarTransferenciasPendientes, cerrarAtencionesHumanasVencidas };
