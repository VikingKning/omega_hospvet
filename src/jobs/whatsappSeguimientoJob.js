// US WA 013: worker persistente que envía la pregunta de seguimiento tras
// 10 minutos de inactividad en esperando_menu/flujo_activo (AC1) y cierra
// la conversación tras 20 minutos adicionales sin respuesta (AC6) — mismo
// patrón setInterval + drain loop que whatsappAgrupacionJob.js.
const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const service = require('../modules/whatsapp/whatsapp.service');

// Drena todos los seguimientos vencidos del ciclo actual, no solo uno.
async function enviarSeguimientosPendientes() {
  let resultado;
  do {
    resultado = await service.procesarSiguienteSeguimientoPendiente();
  } while (resultado !== null);
}

// Drena todas las conversaciones que ya cumplieron los 30 minutos totales
// de inactividad (10 + 20) del ciclo actual.
async function cerrarConversacionesInactivas() {
  let resultado;
  do {
    resultado = await service.cerrarSiguienteConversacionInactiva();
  } while (resultado !== null);
}

// Nunca en NODE_ENV=test (mismo criterio que los otros jobs): evita un
// intervalo de fondo que le impida a Jest terminar.
function start() {
  if (env.nodeEnv === 'test' || !isWhatsappConfigured()) {
    return null;
  }

  const intervalMs = env.whatsapp.agrupacionPollIntervalSeconds * 1000;
  logger.info(
    `Seguimiento y cierre por inactividad de conversaciones de WhatsApp activo, cada ${env.whatsapp.agrupacionPollIntervalSeconds}s.`,
  );

  return setInterval(() => {
    enviarSeguimientosPendientes().catch((err) => {
      logger.error({ err }, 'Falló un ciclo de envío de seguimiento de WhatsApp.');
    });
    cerrarConversacionesInactivas().catch((err) => {
      logger.error({ err }, 'Falló un ciclo de cierre por inactividad de WhatsApp.');
    });
  }, intervalMs);
}

module.exports = { start, enviarSeguimientosPendientes, cerrarConversacionesInactivas };
