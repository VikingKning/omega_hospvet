const EMOJI_REGEX =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu; // eslint-disable-line no-misleading-character-class
const PUNTUACION_PERIFERICA = /^[\s¡!¿?.,;:()"'«»-]+|[\s¡!¿?.,;:()"'«»-]+$/g;

function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(EMOJI_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(PUNTUACION_PERIFERICA, '')
    .trim();
}

const SALUDOS_PUROS = [
  'hola',
  'holi',
  'ola',
  'hey',
  'buenas',
  'buenos dias',
  'buen dia',
  'buenas tardes',
  'buenas noches',
  'que tal',
];

function esSaludoPuro(textoConsolidado) {
  return SALUDOS_PUROS.includes(normalizarTexto(textoConsolidado));
}

const COMANDOS_MENU = ['menu', 'inicio', 'ayuda', 'opciones'];

function esComandoMenu(textoConsolidado) {
  return COMANDOS_MENU.includes(normalizarTexto(textoConsolidado));
}

const MENU_AGENDAR_CONSULTA = 'MENU_AGENDAR_CONSULTA';
const MENU_AGENDAR_ESTETICA = 'MENU_AGENDAR_ESTETICA';
const MENU_RESULTADOS_LAB = 'MENU_RESULTADOS_LAB';
const MENU_EMERGENCIA = 'MENU_EMERGENCIA';
const MENU_RECEPCION = 'MENU_RECEPCION';
const MENU_AVISO_PRIVACIDAD = 'MENU_AVISO_PRIVACIDAD';

const RUTA_POR_MENU_ID = {
  [MENU_AGENDAR_CONSULTA]: 'agendar_consulta',
  [MENU_AGENDAR_ESTETICA]: 'agendar_estetica',
  [MENU_RESULTADOS_LAB]: 'resultados_laboratorio',
  [MENU_EMERGENCIA]: 'emergencia',
  [MENU_RECEPCION]: 'recepcion',
  [MENU_AVISO_PRIVACIDAD]: 'ver_aviso_privacidad',
};

function esIdDeMenu(id) {
  return Object.prototype.hasOwnProperty.call(RUTA_POR_MENU_ID, id);
}

const MENU_HEADER = 'Menú Omega Hospital Veterinario';
const MENU_BODY = 'Elige la opción que mejor describe lo que necesitas:';
const MENU_FOOTER = 'Puedes escribir menú en cualquier momento para volver aquí.';
const MENU_BOTON = 'Ver opciones';
const MENU_SECCION_TITULO = 'Opciones disponibles';
const MENU_FILAS = [
  {
    id: MENU_AGENDAR_CONSULTA,
    title: 'Consulta Veterinaria',
    description: 'Agendar, mover o cancelar una cita veterinaria',
  },
  {
    id: MENU_AGENDAR_ESTETICA,
    title: 'Cita de Estética',
    description: 'Agendar, mover o cancelar una cita de estética',
  },
  {
    id: MENU_RESULTADOS_LAB,
    title: 'Resultado de laboratorio',
    description: 'Consultar el estado de mis resultados',
  },
  {
    id: MENU_EMERGENCIA,
    title: 'Emergencia',
    description: 'Mi mascota necesita atención urgente',
  },
  {
    id: MENU_RECEPCION,
    title: 'Recepción',
    description: 'Hablar directamente con el personal de recepción',
  },
  {
    id: MENU_AVISO_PRIVACIDAD,
    title: 'Aviso de privacidad',
    description: 'Ver el aviso de privacidad y tratamiento de datos personales',
  },
];

function interactivePayload() {
  return {
    type: 'list',
    header: { type: 'text', text: MENU_HEADER },
    body: { text: MENU_BODY },
    footer: { text: MENU_FOOTER },
    action: { button: MENU_BOTON, sections: [{ title: MENU_SECCION_TITULO, rows: MENU_FILAS }] },
  };
}

function textoRespaldo() {
  const lineas = MENU_FILAS.map((fila, indice) => `${indice + 1}. ${fila.title}`);
  return [MENU_HEADER, MENU_BODY, ...lineas, MENU_FOOTER].join('\n');
}

const RESPUESTA_CONTINUAR = 'continuar';
const RESPUESTA_VOLVER_MENU = 'volver_menu';

function seguimientoInteractivePayload() {
  return {
    type: 'button',
    body: { text: '¿Deseas continuar donde te quedaste o volver al menú principal?' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: RESPUESTA_CONTINUAR, title: 'Continuar' } },
        { type: 'reply', reply: { id: RESPUESTA_VOLVER_MENU, title: 'Volver al menú' } },
      ],
    },
  };
}

function textoMedioNoInterpretable() {
  return (
    'Recibimos tu archivo, pero por ahora nuestro asistente no puede interpretarlo automáticamente. ' +
    '¿Nos ayudas describiendo brevemente tu solicitud por escrito? Así podemos ayudarte más rápido.'
  );
}

function textoOpcionInvalida() {
  return 'Esa opción ya no está disponible. Te compartimos el menú nuevamente:';
}

function textoSolicitudEmergencia() {
  return 'Por favor, descríbenos cuál es tu emergencia.';
}

function textoRespaldoEmergencia(telefonoClinica) {
  return (
    'Recibimos tu mensaje y ya estamos canalizando tu emergencia con nuestro personal. ' +
    `Si necesitas hablar de inmediato, llámanos ahora mismo al ${telefonoClinica}.`
  );
}

function textoAvisoPrivacidadNoDisponible(telefonoClinica) {
  return (
    'Por el momento no tenemos un aviso de privacidad disponible para compartir por este medio. ' +
    `Puedes solicitarlo directamente al ${telefonoClinica}.`
  );
}

module.exports = {
  normalizarTexto,
  esSaludoPuro,
  esComandoMenu,
  interactivePayload,
  textoRespaldo,
  textoMedioNoInterpretable,
  textoOpcionInvalida,
  textoSolicitudEmergencia,
  textoRespaldoEmergencia,
  textoAvisoPrivacidadNoDisponible,
  RESPUESTA_CONTINUAR,
  RESPUESTA_VOLVER_MENU,
  seguimientoInteractivePayload,
  MENU_AGENDAR_CONSULTA,
  MENU_AGENDAR_ESTETICA,
  MENU_RESULTADOS_LAB,
  MENU_EMERGENCIA,
  MENU_RECEPCION,
  MENU_AVISO_PRIVACIDAD,
  RUTA_POR_MENU_ID,
  esIdDeMenu,
};
