const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const service = require('../modules/whatsapp/whatsapp.service');
let cicloEnCurso = false;

async function enviarSeguimientosPendientes() {
  let resultado;
  do {
    resultado = await service.procesarSiguienteSeguimientoPendiente();
  } while (resultado !== null);
}

async function cerrarConversacionesInactivas() {
  let resultado;
  do {
    resultado = await service.cerrarSiguienteConversacionInactiva();
  } while (resultado !== null);
}

function start() {
  if (env.nodeEnv === 'test' || !isWhatsappConfigured()) {
    return null;
  }

  const intervalMs = env.whatsapp.agrupacionPollIntervalSeconds * 1000;
  logger.info(
    `Seguimiento y cierre por inactividad de conversaciones de WhatsApp activo, cada ${env.whatsapp.agrupacionPollIntervalSeconds}s.`,
  );

  return setInterval(async () => {
    if (cicloEnCurso) return;
    cicloEnCurso = true;
    try {
      await enviarSeguimientosPendientes();
      await cerrarConversacionesInactivas();
    } catch (err) {
      logger.error({ err }, 'Falló un ciclo de seguimiento y cierre de WhatsApp.');
    } finally {
      cicloEnCurso = false;
    }
  }, intervalMs);
}

module.exports = { start, enviarSeguimientosPendientes, cerrarConversacionesInactivas };
