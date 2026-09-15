// US WA 002: centraliza las transiciones permitidas de
// conversaciones_whatsapp.estado (consideración técnica del US). Solo
// incluye lo que los 18 AC de esta historia realmente ejercitan —
// 'procesando' queda declarado (la consideración técnica lo lista como
// uno de los 6 estados iniciales) pero sin ningún camino de código en
// este US que transicione hacia o desde él.
// US WA 017 (AC6/AC26/AC27): las 4 conversaciones "vivas" (todo menos
// cerrada/atencion_humana) pueden pasar a atencion_humana — vía la
// confirmación de envío del aviso de transferencia (AC6) o vía un mensaje
// manual de Omega detectado por smb_message_echoes (AC25-27, que puede
// llegar sobre CUALQUIERA de estos 4 estados, incluida una conversación
// que apenas se estaba formando). atencion_humana -> cerrada cubre tanto
// el vencimiento (AC15/16) como la reactivación por comando del tutor
// (AC12) — ambos casos cierran la conversación VIEJA antes de crear una
// nueva, nunca reabren esta misma fila.
const TRANSICIONES = {
  acumulando: ['acumulando', 'esperando_menu', 'cerrada', 'procesando', 'atencion_humana'], // + procesando (US WA 003 AC5)
  // + cerrada (US WA 003 AC14: cierre controlado si la conversación vencida ya no tiene mensajes
  // pendientes) + esperando_menu (US WA 004 AC5: el grupo consolidado resultó ser un saludo/comando de menú)
  // + flujo_activo (US WA 014 AC4: el grupo consolidado resultó ser solo medios sin texto).
  procesando: ['cerrada', 'esperando_menu', 'flujo_activo', 'atencion_humana'],
  // + cerrada (US WA 013 AC6: cierre por inactividad tras el seguimiento)
  // + procesando (US WA 005 AC10: el tutor ignoró el menú y escribió texto
  // libre, mismo criterio que acumulando -> procesando)
  // + flujo_activo (US WA 007 AC1: MENU_RESULTADOS_LAB inicia la consulta
  // de laboratorio justo al momento de resolver la selección del menú).
  esperando_menu: ['esperando_menu', 'cerrada', 'procesando', 'flujo_activo', 'atencion_humana'],
  // + procesando (US WA 014 AC5: el tutor escribió su explicación y hay que
  // volver a formar grupo, mismo criterio que acumulando -> procesando).
  flujo_activo: ['flujo_activo', 'esperando_menu', 'cerrada', 'procesando', 'atencion_humana'],
  atencion_humana: ['atencion_humana', 'cerrada'],
  cerrada: [],
};

// US WA 013: los únicos 2 estados sujetos a seguimiento (AC1) y cierre por
// inactividad (AC6/AC8) — compartido entre whatsapp.repository.js (las
// consultas del worker) y whatsapp.service.js (la señal de "resetear el
// control de inactividad" al llegar un mensaje).
const ESTADOS_CON_SEGUIMIENTO = ['esperando_menu', 'flujo_activo'];

function validarTransicion(estadoActual, estadoNuevo) {
  return Boolean(TRANSICIONES[estadoActual]?.includes(estadoNuevo));
}

module.exports = { TRANSICIONES, validarTransicion, ESTADOS_CON_SEGUIMIENTO };
