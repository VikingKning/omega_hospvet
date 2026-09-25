const env = require('./env');
const { minimizarTextoParaClaude } = require('./privacidad');

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5-20251001';

function isClaudeConfigured() {
  return Boolean(env.anthropic.apiKey);
}

const SIN_COINCIDENCIA = 'sin_coincidencia';

const CATEGORIAS = ['emergencia', 'duda_medica', 'agendar_cita', 'resultados_laboratorio'];

const DESCRIPCION_CATEGORIA = {
  emergencia:
    'SOLO peligro de vida inminente y evidente en este momento — no respira, está inconsciente/no reacciona, sangrado que no para, convulsionando ahorita mismo, un envenenamiento con síntomas graves activos, o el tutor dice explícitamente que se está muriendo. Es una categoría MUY estrecha: síntomas preocupantes pero no inmediatamente letales (temblores, chillidos, vómito, decaimiento, una reacción o efecto secundario a un medicamento, una herida, no querer comer) NO son "emergencia" aunque el tutor suene alarmado. Ante la duda entre emergencia y duda_medica, elige duda_medica.',
  agendar_cita:
    'quiere agendar, mover o cancelar una cita NUEVA — una acción concreta sobre el calendario de la clínica (reservar un horario). NO incluye: preguntar por el horario/fecha/detalle de una cita que YA tiene agendada; ni pedir que le llamen, le hablen por teléfono o revisen a su mascota por WhatsApp/llamada para un síntoma puntual (ej. "puedo llamarte para que vean cómo está mi perro") — eso es duda_medica aunque mencione "llamar" o "cita", porque no es una acción de calendario.',
  resultados_laboratorio: 'pregunta por el estado de resultados de laboratorio ya solicitados.',
  // Debe permanecer genérica para funcionar como último recurso sin sesgar la clasificación.
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

// AC de precisión de clasificación (caso real, 19-sep-2026): con solo el
// nombre corto de la intención, Claude no siempre conecta un mensaje
// concreto ("se cayó en un pozo, no respira") con una plantilla específica
// cuyo contenido real sí lo deja claro ("si aún está en el agua...",
// "boca/nariz"). Se reincorpora un resumen del texto_respuesta configurado
// — pasado por minimizarTextoParaClaude para no exponer teléfonos/correos/
// nombres/enlaces reales del cuerpo de la plantilla (ej. el teléfono de la
// clínica que aparece en varias respuestas de emergencia).
function construirOpcionesAnonimas(candidatosReales, slugPorCategoria, nombresConocidos) {
  const especificas = candidatosReales.map((candidato, indice) => {
    const motivo = minimizarTextoParaClaude(
      String(candidato.intencion ?? '').replace(/[_-]+/g, ' '),
      { nombresConocidos, maximoCaracteres: 120 },
    );
    const resumenRespuesta = minimizarTextoParaClaude(candidato.texto_respuesta, {
      nombresConocidos,
      maximoCaracteres: 220,
    });
    return {
      etiqueta: `opcion_${indice + 1}`,
      slug: candidato.slug,
      descripcion: resumenRespuesta
        ? `se usaría para responder algo como "${resumenRespuesta}" (motivo: ${motivo || 'sin motivo registrado'})`
        : motivo || 'motivo general',
    };
  });
  const genericas = CATEGORIAS.filter((categoria) => Boolean(slugPorCategoria[categoria])).map(
    (categoria, indice) => ({
      etiqueta: `categoria_${indice + 1}`,
      slug: slugPorCategoria[categoria],
      descripcion: DESCRIPCION_CATEGORIA[categoria],
    }),
  );
  return { especificas, genericas };
}

function systemPromptUnificado(opciones) {
  return [
    'Eres un clasificador de mensajes de WhatsApp de una clínica veterinaria.',
    'Tu ÚNICO trabajo es decidir con cuál ÚNICA etiqueta anónima de esta lista se describe mejor el mensaje del tutor. Hay dos tipos de opción, compitiendo en igualdad de condiciones:',
    '',
    'A) ESPECÍFICAS — las configuró la clínica para un motivo exacto; tienen prioridad sobre las genéricas de abajo cuando de verdad describen el mensaje. Cada descripción indica cuándo aplica la etiqueta:',
    opciones.especificas.length > 0
      ? opciones.especificas
          .map((opcion) => `- ${opcion.etiqueta}: ${opcion.descripcion || 'motivo general'}`)
          .join('\n')
      : '(la clínica no tiene ninguna configurada todavía)',
    '',
    'B) GENÉRICAS — úsalas SOLO si ninguna opción específica de arriba aplica de verdad:',
    ...opciones.genericas.map((opcion) => `- ${opcion.etiqueta}: ${opcion.descripcion}`),
    '',
    'Regla de desempate: una opción específica de A) gana sobre una genérica de B) cuando de verdad describe el motivo real del mensaje, aunque el mensaje también encaje vagamente en una categoría genérica. Pero NUNCA fuerces una opción específica que no encaja bien solo por una palabra parecida (ej. que ambas mencionen "cita" o "medicamento"): si ninguna específica aplica de verdad, responde la etiqueta genérica correcta de B) en vez de adivinar una específica.',
    '',
    'Tres aclaraciones que aplican a CUALQUIER opción específica, no solo a una en particular:',
    '- Si la descripción de una opción específica depende de haber recibido una foto/imagen/video, esa opción SOLO aplica si el mensaje del tutor menciona o deja claro que mandó ese medio.',
    '- La clínica atiende todo por WhatsApp: pedir que le llamen, hacer una llamada o una videollamada para que revisen a la mascota a distancia SÍ cuenta como pedir una consulta o revisión "por WhatsApp" o "remota", aunque el tutor no use esas palabras exactas.',
    '- Si el mensaje describe una situación de peligro de vida (ahogamiento en agua —incluye pozo, alberca, río, tina, cubeta o cualquier lugar donde pudo haber agua, aunque el mensaje no diga la palabra "agua" explícitamente—, atragantamiento con un objeto, convulsión, sangrado que no cede, envenenamiento, etc.) y una opción específica trae instrucciones de primeros auxilios para ESE escenario exacto, esa opción SIEMPRE le gana a la genérica de emergencia: la genérica no da ninguna instrucción mientras llega ayuda y la específica sí. Esto aplica aunque el tutor ya haya resuelto parte de un paso que la plantilla describe (ej. si ya sacó a la mascota del agua o del pozo, la plantilla de ahogamiento sigue aplicando para el resto de las instrucciones) y aunque el mensaje también contenga una frase genérica de emergencia como "no respira" — esa frase por sí sola no descarta la opción específica, al contrario, es la señal de que sí aplica. Cuidado con no confundir un ahogamiento por agua con uno por atragantamiento con un objeto — son escenarios distintos con primeros auxilios distintos, aunque ambos usen la palabra "ahogamiento".',
    '',
    reglasComunes([
      ...opciones.especificas.map((opcion) => opcion.etiqueta),
      ...opciones.genericas.map((opcion) => opcion.etiqueta),
    ]),
  ].join('\n');
}

async function clasificar(mensaje, systemPrompt, etiquetasValidas) {
  if (!isClaudeConfigured()) {
    const error = new Error('El clasificador de Claude no está configurado.');
    error.code = 'CLAUDE_NOT_CONFIGURED';
    error.llamadaReal = false;
    throw error;
  }

  let res;
  try {
    res = await fetch(API_URL, {
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
      signal: AbortSignal.timeout(env.anthropic.timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      const timeoutError = new Error(
        `Claude API excedió el tiempo límite de ${env.anthropic.timeoutMs} ms.`,
      );
      timeoutError.code = 'CLAUDE_TIMEOUT';
      timeoutError.llamadaReal = true;
      throw timeoutError;
    }
    err.code = err.code || 'CLAUDE_API_ERROR';
    err.llamadaReal = true;
    throw err;
  }

  if (!res.ok) {
    const error = new Error(`Claude API respondió con HTTP ${res.status}.`);
    error.code = 'CLAUDE_API_ERROR';
    error.llamadaReal = true;
    throw error;
  }

  const data = await res.json();
  const etiquetaCruda = data.content?.[0]?.text?.trim().toLowerCase();
  // Compara sin distinguir mayúsculas, pero conserva el slug almacenado originalmente.
  const etiqueta =
    etiquetasValidas.find((valida) => valida.toLowerCase() === etiquetaCruda) ?? null;

  const respuesta = {
    etiqueta,
    tokensEntrada: data.usage?.input_tokens ?? 0,
    tokensSalida: data.usage?.output_tokens ?? 0,
  };
  Object.defineProperty(respuesta, 'resultado', {
    enumerable: false,
    value:
      etiquetaCruda === SIN_COINCIDENCIA
        ? 'sin_coincidencia'
        : etiqueta
          ? 'exito'
          : 'etiqueta_invalida',
  });
  return respuesta;
}

async function clasificarMensaje(
  mensaje,
  candidatosReales,
  slugPorCategoria,
  { nombresConocidos = [] } = {},
) {
  const opciones = construirOpcionesAnonimas(candidatosReales, slugPorCategoria, nombresConocidos);
  const mapaEtiquetas = new Map(
    [...opciones.especificas, ...opciones.genericas].map((opcion) => [
      opcion.etiqueta,
      opcion.slug,
    ]),
  );
  const mensajeMinimizado = minimizarTextoParaClaude(mensaje, { nombresConocidos });
  const clasificacion = await clasificar(mensajeMinimizado, systemPromptUnificado(opciones), [
    ...mapaEtiquetas.keys(),
  ]);
  const respuesta = {
    ...clasificacion,
    etiqueta: mapaEtiquetas.get(clasificacion.etiqueta) ?? null,
  };
  Object.defineProperty(respuesta, 'resultado', {
    enumerable: false,
    value: clasificacion.resultado,
  });
  return respuesta;
}

module.exports = {
  isClaudeConfigured,
  clasificarMensaje,
  CATEGORIAS,
  SIN_COINCIDENCIA,
  MODEL,
  minimizarTextoParaClaude,
};
