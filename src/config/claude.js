// Clasificador de intención de WhatsApp (Bitácora de Decisiones Técnicas
// v4: "claude-haiku-4-5 vía Claude API, Commercial Terms — solo clasifica
// en rutas fijas, nunca genera contenido médico libre; el texto siempre
// sale de plantillas_whatsapp"). Llamadas HTTP directas a la API de
// Anthropic vía `fetch` nativo, sin SDK — mismo criterio que
// config/whatsapp.js.
const env = require('./env');

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Modelo fijo por decisión de la Bitácora — nunca elegible desde la
// consola de Anthropic (el API key no está atado a un modelo, se manda en
// cada request).
const MODEL = 'claude-haiku-4-5-20251001';

function isClaudeConfigured() {
  return Boolean(env.anthropic.apiKey);
}

// Sentinel para "el mensaje no encaja con ninguna etiqueta conocida" —
// nunca se inventa una fuera de la lista dada, y nunca se regresa texto
// libre: solo esta etiqueta o una de las válidas.
const SIN_COINCIDENCIA = 'sin_coincidencia';

// Las 4 categorías fijas de mensajes_whatsapp.categoria_clasificacion
// (sección 1.3 del documento funcional del cliente) — siguen existiendo
// como el valor que se guarda en esa columna para reportes/métricas, pero
// YA NO se evalúan en una llamada separada "antes" del catálogo real (ver
// más abajo, clasificarMensaje): compiten en la MISMA llamada, como
// opciones genéricas, contra las intenciones específicas configuradas por
// la clínica.
const CATEGORIAS = ['emergencia', 'duda_medica', 'agendar_cita', 'resultados_laboratorio'];

// Descripciones de las 4 categorías genéricas — cuidadosamente afinadas en
// vivo contra casos reales reportados por el cliente (temblores/efectos
// secundarios que no son "emergencia"; "puedo llamarte" que no es
// "agendar_cita"). Se mantienen intactas en el rediseño a llamada única:
// el problema que este rediseño corrige no era el TEXTO de estas
// descripciones, sino que antes se evaluaban en un prompt aparte, SIN
// ninguna intención específica real con la que competir — ahora compiten
// codo a codo con el catálogo real en un solo prompt.
const DESCRIPCION_CATEGORIA = {
  emergencia:
    'SOLO peligro de vida inminente y evidente en este momento — no respira, está inconsciente/no reacciona, sangrado que no para, convulsionando ahorita mismo, un envenenamiento con síntomas graves activos, o el tutor dice explícitamente que se está muriendo. Es una categoría MUY estrecha: síntomas preocupantes pero no inmediatamente letales (temblores, chillidos, vómito, decaimiento, una reacción o efecto secundario a un medicamento, una herida, no querer comer) NO son "emergencia" aunque el tutor suene alarmado. Ante la duda entre emergencia y duda_medica, elige duda_medica.',
  agendar_cita:
    'quiere agendar, mover o cancelar una cita NUEVA — una acción concreta sobre el calendario de la clínica (reservar un horario). NO incluye: preguntar por el horario/fecha/detalle de una cita que YA tiene agendada; ni pedir que le llamen, le hablen por teléfono o revisen a su mascota por WhatsApp/llamada para un síntoma puntual (ej. "puedo llamarte para que vean cómo está mi perro") — eso es duda_medica aunque mencione "llamar" o "cita", porque no es una acción de calendario.',
  resultados_laboratorio: 'pregunta por el estado de resultados de laboratorio ya solicitados.',
  // A propósito NO se enumeran aquí ejemplos de síntomas/motivos médicos
  // (temblores, pedir una llamada, heridas, etc.): esta es la única
  // categoría genérica que no describe un caso concreto, sino "ninguna de
  // las anteriores" — es el último recurso, no una alternativa a competir
  // por descripción contra las etiquetas específicas de A). Un texto largo
  // y detallado aquí termina ganándole a etiquetas específicas reales que
  // sí aplican mejor (confirmado en vivo: una versión anterior, más
  // descriptiva, le ganaba sistemáticamente a "Revision medica por
  // whatsapp" en mensajes que pedían justo eso).
  duda_medica:
    'cualquier otro mensaje del tutor relacionado con la clínica o su mascota que no describa bien ninguna etiqueta específica de A) ni ninguna de las otras 3 categorías genéricas. Es el último recurso: si una etiqueta específica de A) sí aplica, sigue ganando ella aunque el mensaje también pudiera describirse vagamente como "duda_medica".',
};

function reglasComunes(etiquetasValidas) {
  return [
    `Si el mensaje no encaja claramente con ninguna, responde exactamente: ${SIN_COINCIDENCIA}`,
    '',
    'Reglas estrictas:',
    `- Responde ÚNICAMENTE con una de estas etiquetas, en minúsculas, tal cual, nada más: ${etiquetasValidas.join(', ')}, ${SIN_COINCIDENCIA}`,
    '- NUNCA generes una respuesta médica, una explicación, ni texto para el tutor: eso lo decide la clínica, no tú.',
    '- Ante cualquier duda o mensaje ambiguo, responde `sin_coincidencia` en vez de adivinar.',
  ].join('\n');
}

// Prompt único (rediseño explícito del usuario, 2026-09-12: "creo que los
// default deberian ser evaluados al final, si no hay otra plantilla que
// tenga...un % mas alto de probabilidad...entonces si ver los default" —
// y "no quiero que estemos modificando el prompt para ajustar a las
// necesidades [de cada caso nuevo]"). Antes había 2 llamadas separadas:
// 1ro se elegía 1 de las 4 categorías fijas (sin ver el catálogo real),
// 2do —SOLO dentro de 'duda_medica'— se comparaba contra el catálogo. Eso
// tenía dos fallas de raíz, ambas confirmadas en vivo contra la API real:
// (a) una plantilla real específica (ej. "Urgencia por ahogamiento")
// nunca tenía oportunidad si el primer filtro ya había elegido
// 'emergencia'/'agendar_cita'; (b) al invertir el orden ingenuamente
// (catálogo primero, categorías como respaldo — ver commit anterior a
// este), surgió una regresión nueva: con SOLO las etiquetas específicas
// como opciones (sin ninguna genérica bien descrita con la que competir),
// Claude a veces "forzaba" la más parecida por léxico (ej. "quiero
// agendar una cita" → "revisar cita agendada") en vez de reconocer que
// ninguna encajaba de verdad. La causa de fondo no era el texto de un
// prompt, sino la SEPARACIÓN en 2 llamadas: aquí se resuelve juntando
// ambos conjuntos de etiquetas —específicas y genéricas— en una sola
// llamada, con una regla explícita de desempate, para que Claude siempre
// tenga la alternativa genérica correcta disponible como comparación
// antes de forzar una específica que no encaja bien.
// Las etiquetas específicas son un `intencion` corto (a veces una sola
// frase) sin ninguna descripción propia — comparadas en desventaja contra
// las 4 categorías genéricas de arriba, que sí traen un párrafo completo
// explicando cuándo aplican. Para que Claude pueda juzgar de verdad si una
// específica "aplica" (y no solo adivinar por parecido de palabras en la
// etiqueta desnuda), se le da como contexto un resumen del
// `texto_respuesta` de esa plantilla — el dato ya existe en la BD (es la
// respuesta real que el staff configuró para ese motivo) y describe con
// precisión cuándo corresponde usarla, sin que nadie tenga que redactar
// una descripción aparte ni retocar el prompt por cada plantilla nueva.
function resumenTextoRespuesta(texto, maxLen = 160) {
  const limpio = (texto || '').replace(/\s+/g, ' ').trim();
  return limpio.length > maxLen ? `${limpio.slice(0, maxLen)}…` : limpio;
}

function systemPromptUnificado(candidatosReales) {
  return [
    'Eres un clasificador de mensajes de WhatsApp de una clínica veterinaria.',
    'Tu ÚNICO trabajo es decidir con cuál ÚNICA etiqueta de esta lista se describe mejor el mensaje del tutor. Hay dos tipos de etiqueta, compitiendo en igualdad de condiciones:',
    '',
    'A) ESPECÍFICAS — las configuró la clínica para un motivo exacto; tienen prioridad sobre las genéricas de abajo cuando de verdad describen el mensaje. El NOMBRE de cada etiqueta ya describe el motivo por el que la clínica la creó — es la pista más directa de cuándo aplica. El resumen de su respuesta es SOLO contexto adicional (a veces la respuesta declina o redirige la solicitud en vez de resolverla directamente, y aun así la etiqueta sigue aplicando si el motivo del mensaje del tutor coincide con el motivo del nombre):',
    candidatosReales.length > 0
      ? candidatosReales
          .map(
            (c) =>
              `- ${c.intencion}: se usaría para responder algo como "${resumenTextoRespuesta(c.texto_respuesta)}"`,
          )
          .join('\n')
      : '(la clínica no tiene ninguna configurada todavía)',
    '',
    'B) GENÉRICAS — úsalas SOLO si ninguna etiqueta específica de arriba aplica de verdad:',
    `- emergencia: ${DESCRIPCION_CATEGORIA.emergencia}`,
    `- agendar_cita: ${DESCRIPCION_CATEGORIA.agendar_cita}`,
    `- resultados_laboratorio: ${DESCRIPCION_CATEGORIA.resultados_laboratorio}`,
    `- duda_medica: ${DESCRIPCION_CATEGORIA.duda_medica}`,
    '',
    'Regla de desempate: una etiqueta específica de A) gana sobre una genérica de B) cuando de verdad describe el motivo real del mensaje, aunque el mensaje también encaje vagamente en una categoría genérica. Pero NUNCA fuerces una etiqueta específica que no encaja bien solo por una palabra parecida (ej. que ambas mencionen "cita" o "medicamento"): si ninguna específica aplica de verdad, responde la categoría genérica correcta de B) en vez de adivinar una específica.',
    '',
    'Dos aclaraciones que aplican a CUALQUIER etiqueta específica, no solo a una en particular:',
    '- Si la respuesta de una etiqueta específica agradece o depende de haber recibido una foto/imagen/video (ej. empieza con "gracias por la foto"), esa etiqueta SOLO aplica si el mensaje del tutor menciona o deja claro que mandó una foto/imagen/video. Si no mandó nada, esa etiqueta no aplica aunque el tema se parezca — compara contra otra específica o una genérica.',
    '- La clínica atiende todo por WhatsApp: pedir que le llamen, hacer una llamada o una videollamada para que revisen a la mascota a distancia SÍ cuenta como pedir una consulta o revisión "por WhatsApp" o "remota", aunque el tutor no use esas palabras exactas.',
    '',
    reglasComunes([...candidatosReales.map((c) => c.intencion), ...CATEGORIAS]),
  ].join('\n');
}

// Llamada real a la API. Regresa `etiqueta: null` si Claude no encaja el
// mensaje con ninguna, o si por cualquier motivo la respuesta no viene
// EXACTAMENTE en la lista dada (defensivo: nunca se confía a ciegas en la
// salida del modelo) — nunca lanza por un "sin coincidencia", solo por
// fallas reales de la API.
async function clasificar(mensaje, systemPrompt, etiquetasValidas) {
  if (!isClaudeConfigured()) {
    throw new Error('El clasificador de Claude no está configurado (falta ANTHROPIC_API_KEY).');
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.anthropic.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 20,
      system: systemPrompt,
      messages: [{ role: 'user', content: mensaje }],
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`Claude API respondió ${res.status}: ${detalle}`);
  }

  const data = await res.json();
  const etiquetaCruda = data.content?.[0]?.text?.trim().toLowerCase();
  // Bug real encontrado en vivo: comparar contra `etiquetasValidas` tal
  // cual (sin normalizar mayúsculas) descartaba SIEMPRE cualquier
  // intención con una mayúscula (ej. "Urgencia por ahogamiento", "Revision
  // medica por whatsapp") — Claude podía responder exactamente bien y el
  // match se rechazaba de todos modos por la diferencia de mayúsculas.
  // find() + comparación en minúsculas en AMBOS lados, pero se regresa la
  // etiqueta con el casing ORIGINAL de `etiquetasValidas` (no la versión
  // en minúsculas de Claude): el llamador compara este valor contra
  // `plantillas_whatsapp.intencion` tal cual está guardada en la BD.
  const etiqueta =
    etiquetasValidas.find((valida) => valida.toLowerCase() === etiquetaCruda) ?? null;

  return {
    etiqueta,
    tokensEntrada: data.usage?.input_tokens ?? 0,
    tokensSalida: data.usage?.output_tokens ?? 0,
  };
}

// Única llamada de clasificación: compara el mensaje contra TODO el
// catálogo real de plantillas activas Y las 4 categorías genéricas fijas,
// al mismo tiempo — ver systemPromptUnificado para el porqué de juntarlas
// en un solo prompt en vez de 2 llamadas separadas.
// `candidatosReales` son objetos `{ intencion, texto_respuesta }` (no
// strings sueltos): systemPromptUnificado usa `texto_respuesta` para darle
// a cada etiqueta específica el mismo nivel de contexto semántico que ya
// tienen las 4 categorías genéricas (ver el comentario de
// resumenTextoRespuesta) — sin eso, una etiqueta específica sin
// descripción pierde sistemáticamente contra una genérica bien descrita
// aunque sea la que de verdad aplica. `etiqueta` puede salir siendo una
// `candidatosReales[].intencion` (con su casing original) o una de
// CATEGORIAS o null (sin_coincidencia / respuesta inesperada) — el
// llamador (whatsapp.service.js) decide qué hacer con cada caso.
async function clasificarMensaje(mensaje, candidatosReales) {
  return clasificar(mensaje, systemPromptUnificado(candidatosReales), [
    ...candidatosReales.map((c) => c.intencion),
    ...CATEGORIAS,
  ]);
}

module.exports = {
  isClaudeConfigured,
  clasificarMensaje,
  CATEGORIAS,
  SIN_COINCIDENCIA,
  MODEL,
};
