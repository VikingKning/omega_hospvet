// US WA 017: worker persistente que envía los avisos de transferencia
// pendientes (AC5/AC6/AC19) y cierra las conversaciones cuya atención
// humana ya venció (AC15) — mismo patrón setInterval + drain loop que
// whatsappSeguimientoJob.js/whatsappAgrupacionJob.js.
const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const service = require('../modules/whatsapp/whatsapp.atencionHumana.service');
let cicloEnCurso = false;

// Drena todas las solicitudes listas para enviar/reintentar del ciclo
// actual, no solo una.
async function enviarTransferenciasPendientes() {
  let resultado;
  do {
    resultado = await service.procesarSiguienteSolicitudPendiente();
  } while (resultado !== null);
}

// Drena todas las conversaciones en atencion_humana ya vencidas del ciclo
// actual.
async function cerrarAtencionesHumanasVencidas() {
  let resultado;
  do {
    resultado = await service.cerrarSiguienteAtencionHumanaVencida();
  } while (resultado !== null);
}

// Nunca en NODE_ENV=test (mismo criterio que los otros jobs de WhatsApp):
// evita un intervalo de fondo que le impida a Jest terminar.
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
