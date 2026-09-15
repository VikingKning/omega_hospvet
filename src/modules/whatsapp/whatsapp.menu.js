// US WA 004: normalización + detección de saludo puro / comando de menú
// sobre texto ya consolidado (grupos_whatsapp.texto_consolidado), y la
// configuración controlada del menú principal (consideración técnica). No
// vive en plantillas_whatsapp porque esa tabla solo tiene un texto plano
// (texto_respuesta) y está acotada a respuestas de Claude (ver su propio
// comentario de cabecera + findActivasParaClasificar) — no puede
// representar header/body/footer/botón/filas sin una migración que nadie
// pidió. Los `id` de cada fila son el identificador interno estable exigido
// por la consideración técnica — nunca se decide una ruta por `title`.

// Rango amplio mas emoji/variation-selector (U+FE0F)/ZWJ (U+200D) comunes —
// no incluye puntuación ni dígitos, así que no toca contenido clínico. Son
// puntos de código individuales a eliminar, no una secuencia combinada.
const EMOJI_REGEX =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu; // eslint-disable-line no-misleading-character-class
const PUNTUACION_PERIFERICA = /^[\s¡!¿?.,;:()"'«»-]+|[\s¡!¿?.,;:()"'«»-]+$/g;

// Acentos/mayúsculas/espacios repetidos/puntuación periférica/emojis se
// recortan; nunca se tocan palabras internas (AC4 de US WA 004: "Hola mi
// perro está convulsionando" debe seguir sin ser un saludo puro).
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

// ASUNCIÓN DE CONTENIDO (la historia no trae una lista verbatim) — sujeta a
// corrección en revisión.
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

// AC1/AC3/AC4 (US WA 004): coincidencia EXACTA sobre el texto normalizado
// completo — nunca subcadena — para que "saludo + consulta" no cuente como
// saludo puro.
function esSaludoPuro(textoConsolidado) {
  return SALUDOS_PUROS.includes(normalizarTexto(textoConsolidado));
}

// AC2 (US WA 004): "menú, menu, inicio, ayuda o una variante configurada" —
// 'menu' ya cubre 'menú' una vez normalizado. ASUNCIÓN DE CONTENIDO: se
// agrega 'opciones' como la variante configurada, sin inventar un mecanismo
// de configuración externo que nadie pidió.
const COMANDOS_MENU = ['menu', 'inicio', 'ayuda', 'opciones'];

function esComandoMenu(textoConsolidado) {
  return COMANDOS_MENU.includes(normalizarTexto(textoConsolidado));
}

// US WA 005 (consideración técnica): "Definir los ids MENU_AGENDAR_CONSULTA,
// MENU_AGENDAR_ESTETICA, MENU_RESULTADOS_LAB, MENU_EMERGENCIA y
// MENU_RECEPCION como constantes" — son el `id` interno estable de cada
// fila del menú (nunca se decide una ruta por `title`). El valor de cada
// constante es literalmente su propio nombre: son solo etiquetas internas
// que Meta nos regresa tal cual, no hace falta ningún otro formato.
const MENU_AGENDAR_CONSULTA = 'MENU_AGENDAR_CONSULTA';
const MENU_AGENDAR_ESTETICA = 'MENU_AGENDAR_ESTETICA';
const MENU_RESULTADOS_LAB = 'MENU_RESULTADOS_LAB';
const MENU_EMERGENCIA = 'MENU_EMERGENCIA';
const MENU_RECEPCION = 'MENU_RECEPCION';

// AC3-AC7 (US WA 005): el identificador de RUTA que esta historia devuelve
// para cada id de menú — los 5 valores están dados literalmente en los AC,
// no son una asunción. Ninguno de los 5 se ejecuta desde esta historia
// (agendar, laboratorio, emergencia, recepción quedan para la historia
// responsable de esa ruta, AC13).
const RUTA_POR_MENU_ID = {
  [MENU_AGENDAR_CONSULTA]: 'agendar_consulta',
  [MENU_AGENDAR_ESTETICA]: 'agendar_estetica',
  [MENU_RESULTADOS_LAB]: 'resultados_laboratorio',
  [MENU_EMERGENCIA]: 'emergencia',
  [MENU_RECEPCION]: 'recepcion',
};

function esIdDeMenu(id) {
  return Object.prototype.hasOwnProperty.call(RUTA_POR_MENU_ID, id);
}

// AC1 (US WA 005): los 5 títulos están dados literalmente en la historia.
// ASUNCIÓN DE CONTENIDO: header/body/footer/botón/descripciones, sin copy
// verbatim en la historia — sujeto a corrección en revisión.
const MENU_HEADER = 'Menú Omega Hospital Veterinario';
const MENU_BODY = 'Elige la opción que mejor describe lo que necesitas:';
// Límite duro de Meta para list.footer.text: 60 caracteres — la versión con
// comillas alrededor de "menú" medía 61 y provocaba el rechazo (#131009).
const MENU_FOOTER = 'Puedes escribir menú en cualquier momento para volver aquí.';
const MENU_BOTON = 'Ver opciones';
const MENU_SECCION_TITULO = 'Opciones disponibles';
const MENU_FILAS = [
  {
    // Límite duro de Meta para list.rows[].title: 24 caracteres —
    // "Cita Consulta Veterinaria" medía 25 y provocaba el rechazo
    // (#131009); "Consulta Veterinaria" mide 20.
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
    // Límite duro de Meta para list.rows[].title: 24 caracteres — "Resultados
    // de laboratorio" medía 25 y provocaba el rechazo (#131009); "Resultado
    // de laboratorio" (singular) mide exactamente 24.
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
];

// Consideración técnica de US WA 004: "Crear enviarMenuPrincipal con type
// interactive y subtype list" — esta función arma el contenido de esa
// parte `interactive`; quien envía es whatsapp.outbox.js.
function interactivePayload() {
  return {
    type: 'list',
    header: { type: 'text', text: MENU_HEADER },
    body: { text: MENU_BODY },
    footer: { text: MENU_FOOTER },
    action: { button: MENU_BOTON, sections: [{ title: MENU_SECCION_TITULO, rows: MENU_FILAS }] },
  };
}

// AC6 (US WA 004): respaldo textual cuando Meta rechaza el menú interactivo
// — mismas opciones, renderizadas como lista numerada en texto plano.
function textoRespaldo() {
  const lineas = MENU_FILAS.map((fila, indice) => `${indice + 1}. ${fila.title}`);
  return [MENU_HEADER, MENU_BODY, ...lineas, MENU_FOOTER].join('\n');
}

// US WA 013 (consideración técnica): "Usar identificadores RESPUESTA_CONTINUAR
// y RESPUESTA_VOLVER_MENU para los botones del seguimiento" — ids internos
// estables del botón de respuesta rápida (Meta interactive/button), nunca
// se decide nada por el título visible.
const RESPUESTA_CONTINUAR = 'continuar';
const RESPUESTA_VOLVER_MENU = 'volver_menu';

// AC1 (US WA 013): la pregunta de seguimiento con exactamente 2 botones de
// respuesta rápida — mismo criterio de "configuración controlada" que el
// menú principal. ASUNCIÓN DE CONTENIDO: el texto del cuerpo, sin copy
// verbatim en la historia.
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

// US WA 014 (AC4, técnica "mantener el texto de orientación en
// configuración controlada"): texto plano, sin botones — la historia solo
// pide "una sola respuesta solicitando que el tutor describa brevemente su
// solicitud por escrito". ASUNCIÓN DE CONTENIDO: no hay copy verbatim.
function textoMedioNoInterpretable() {
  return (
    'Recibimos tu archivo, pero por ahora nuestro asistente no puede interpretarlo automáticamente. ' +
    '¿Nos ayudas describiendo brevemente tu solicitud por escrito? Así podemos ayudarte más rápido.'
  );
}

// US WA 005 (AC9, técnica "mantener el texto de orientación en
// configuración controlada"): se envía junto con un menú nuevo cuando la
// selección recibida es desconocida, manipulada o de un menú vencido.
// ASUNCIÓN DE CONTENIDO: no hay copy verbatim en la historia.
function textoOpcionInvalida() {
  return 'Esa opción ya no está disponible. Te compartimos el menú nuevamente:';
}

// US WA 009 (AC1): texto EXACTO dado por la historia — a diferencia del
// resto de textos de este módulo, este NO es una asunción de contenido.
function textoSolicitudEmergencia() {
  return 'Por favor, descríbenos cuál es tu emergencia.';
}

// US WA 009 (AC20, consideración técnica: "mantener el texto absoluto de
// respaldo para emergencias en una configuración controlada... con el
// medio oficial de contacto vigente") — se usa SOLO cuando la plantilla
// resuelta ya es es_emergencia=true pero su contenido no se pudo
// recuperar; a diferencia de TEXTO_RESPALDO_ABSOLUTO de whatsapp.service.js
// (que se usa cuando NO hay emergencia, AC18), este conserva el tono de
// urgencia — ASUNCIÓN DE CONTENIDO, sujeta a corrección en revisión.
function textoRespaldoEmergencia(telefonoClinica) {
  return (
    'Recibimos tu mensaje y ya estamos canalizando tu emergencia con nuestro personal. ' +
    `Si necesitas hablar de inmediato, llámanos ahora mismo al ${telefonoClinica}.`
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
  RESPUESTA_CONTINUAR,
  RESPUESTA_VOLVER_MENU,
  seguimientoInteractivePayload,
  MENU_AGENDAR_CONSULTA,
  MENU_AGENDAR_ESTETICA,
  MENU_RESULTADOS_LAB,
  MENU_EMERGENCIA,
  MENU_RECEPCION,
  RUTA_POR_MENU_ID,
  esIdDeMenu,
};
