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
// (sección 1.3 del documento funcional del cliente) — primer nivel de
// clasificación, siempre corre antes que clasificarIntencion() (2do
// nivel, solo aplica dentro de 'duda_medica').
const CATEGORIAS = ['emergencia', 'duda_medica', 'agendar_cita', 'resultados_laboratorio'];

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

function systemPromptCategoria() {
  return [
    'Eres un clasificador de mensajes de WhatsApp de una clínica veterinaria.',
    'Tu ÚNICO trabajo es decidir a cuál de estas 4 categorías fijas corresponde el mensaje del tutor:',
    '- emergencia: una urgencia médica real, algo que no puede esperar.',
    '- duda_medica: una pregunta o duda de cuidado/tratamiento que NO es urgente.',
    '- agendar_cita: quiere agendar, mover o cancelar una cita.',
    '- resultados_laboratorio: pregunta por el estado de resultados de laboratorio ya solicitados.',
    '',
    reglasComunes(CATEGORIAS),
  ].join('\n');
}

function systemPromptIntencion(intencionesValidas) {
  return [
    'Eres un clasificador de intención para mensajes de WhatsApp de una clínica veterinaria.',
    'Tu ÚNICO trabajo es decidir a cuál de estas intenciones fijas corresponde el mensaje del tutor:',
    intencionesValidas.map((i) => `- ${i}`).join('\n'),
    '',
    reglasComunes(intencionesValidas),
  ].join('\n');
}

// Llamada real a la API — compartida por clasificarCategoria() y
// clasificarIntencion(), la única diferencia entre ambas es qué
// systemPrompt/lista de etiquetas válidas usan. Regresa `etiqueta: null`
// si Claude no encaja el mensaje con ninguna, o si por cualquier motivo la
// respuesta no viene EXACTAMENTE en la lista dada (defensivo: nunca se
// confía a ciegas en la salida del modelo) — nunca lanza por un "sin
// coincidencia", solo por fallas reales de la API.
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
  const etiqueta = etiquetasValidas.includes(etiquetaCruda) ? etiquetaCruda : null;

  return {
    etiqueta,
    tokensEntrada: data.usage?.input_tokens ?? 0,
    tokensSalida: data.usage?.output_tokens ?? 0,
  };
}

// 1er nivel: 1 de las 4 categorías fijas de mensajes_whatsapp.
async function clasificarCategoria(mensaje) {
  return clasificar(mensaje, systemPromptCategoria(), CATEGORIAS);
}

// 2do nivel, SOLO dentro de la categoría 'duda_medica': contra la lista
// cerrada `intencionesValidas` (los valores de plantillas_whatsapp.intencion
// que estén activos).
async function clasificarIntencion(mensaje, intencionesValidas) {
  return clasificar(mensaje, systemPromptIntencion(intencionesValidas), intencionesValidas);
}

module.exports = {
  isClaudeConfigured,
  clasificarCategoria,
  clasificarIntencion,
  CATEGORIAS,
  SIN_COINCIDENCIA,
  MODEL,
};
