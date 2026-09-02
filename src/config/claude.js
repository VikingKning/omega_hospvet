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

// Sentinel para "el mensaje no encaja con ninguna intención conocida" —
// nunca se inventa una intención fuera de la lista dada, y nunca se
// regresa texto libre: solo esta etiqueta o una de `intencionesValidas`.
const SIN_COINCIDENCIA = 'sin_coincidencia';

function construirSystemPrompt(intencionesValidas) {
  return [
    'Eres un clasificador de intención para mensajes de WhatsApp de una clínica veterinaria.',
    'Tu ÚNICO trabajo es decidir a cuál de estas intenciones fijas corresponde el mensaje del tutor:',
    intencionesValidas.map((i) => `- ${i}`).join('\n'),
    `Si el mensaje no encaja claramente con ninguna, responde exactamente: ${SIN_COINCIDENCIA}`,
    '',
    'Reglas estrictas:',
    '- Responde ÚNICAMENTE con una de las etiquetas de arriba, en minúsculas, tal cual — nada más.',
    '- NUNCA generes una respuesta médica, una explicación, ni texto para el tutor: eso lo decide la clínica, no tú.',
    '- Ante cualquier duda o mensaje ambiguo, responde `sin_coincidencia` en vez de adivinar.',
  ].join('\n');
}

// Clasifica `mensaje` contra la lista cerrada `intencionesValidas` (los
// valores de plantillas_whatsapp.intencion que estén activos) — regresa
// una de esas cadenas, o `null` si Claude no encaja el mensaje con
// ninguna, o si por cualquier motivo la respuesta no viene exactamente en
// la lista (defensivo: nunca se confía a ciegas en la salida del modelo).
async function clasificarIntencion(mensaje, intencionesValidas) {
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
      system: construirSystemPrompt(intencionesValidas),
      messages: [{ role: 'user', content: mensaje }],
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`Claude API respondió ${res.status}: ${detalle}`);
  }

  const data = await res.json();
  const etiqueta = data.content?.[0]?.text?.trim().toLowerCase();

  if (intencionesValidas.includes(etiqueta)) return etiqueta;
  return null;
}

module.exports = { isClaudeConfigured, clasificarIntencion, SIN_COINCIDENCIA, MODEL };
