// US WA 003: worker persistente que agrupa los fragmentos de una
// conversación tras vencer su ventana de inactividad — reemplaza al
// disparo fire-and-forget que antes clasificaba/respondía casi al
// instante (ver whatsapp.controller.js). setInterval simple, mismo patrón
// que los otros jobs de este directorio, pero en SEGUNDOS y corto: el
// objetivo es cerrar la ventana de 10s casi en tiempo real, no una
// sincronización de catálogo cada rato.
const env = require('../config/env');
const logger = require('../config/logger');
const { isWhatsappConfigured } = require('../config/whatsapp');
const service = require('../modules/whatsapp/whatsapp.service');
let cicloEnCurso = false;

// Drena TODAS las conversaciones vencidas del ciclo actual, no solo una —
// si varias vencen casi juntas, procesar una por ciclo sería demasiado
// lento para el propósito de esta historia (AC4: "no usar setTimeout como
// única fuente de verdad" implica un worker que de verdad revise el
// reloj de Postgres seguido, no uno perezoso).
async function revisarConversacionesVencidas() {
  let resultado;
  do {
    resultado = await service.procesarSiguienteConversacionVencida();
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
