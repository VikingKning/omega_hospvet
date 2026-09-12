// Procesa un mensaje entrante de WhatsApp (whatsapp.controller.js#recibir)
// — clasificación en UNA SOLA llamada (rediseño explícito del usuario,
// 2026-09-12; ver src/config/claude.js#clasificarMensaje para el porqué
// completo): el mensaje se compara, en el mismo prompt, contra TODAS las
// `plantillas_whatsapp.intencion` reales y activas Y las 4 categorías
// genéricas fijas (`categoria_clasificacion`) al mismo tiempo — nunca en
// 2 pasos separados.
//
// Motivo del rediseño (2 intentos previos, ambos insuficientes):
// 1. El diseño original (Bitácora v4/sección 1.3) decidía 1 de las 4
//    categorías fijas ANTES de mirar el catálogo real, y solo dentro de
//    'duda_medica' comparaba contra las plantillas reales — una plantilla
//    específica (ej. "Urgencia por ahogamiento") nunca tenía oportunidad
//    si el primer filtro ya había elegido 'emergencia'/'agendar_cita'.
// 2. Invertir el orden (probar el catálogo primero, categorías fijas
//    SOLO como respaldo) arregló eso, pero introdujo una regresión nueva:
//    con solo las etiquetas específicas como opciones —sin ninguna
//    genérica bien descrita con la que competir—, Claude a veces forzaba
//    la más parecida por léxico (ej. "quiero agendar una cita" → la
//    plantilla real "revisar cita agendada") en vez de reconocer que
//    ninguna encajaba de verdad.
// La causa de fondo en ambos casos era la SEPARACIÓN en llamadas
// distintas, no el texto de un prompt — por eso ajustar prompts caso por
// caso no escala (pedido explícito del usuario: "lo que pongan los
// usuarios reales debería ser bien clasificado sin tener que estar
// interviniendo en el prompt"). Una sola llamada con ambos conjuntos de
// etiquetas presentes a la vez, más una regla explícita de desempate
// ("específica gana solo si de verdad aplica"), resuelve la causa de raíz.
//
// `categoria_clasificacion` se sigue guardando con el mismo significado
// de siempre para reportes/métricas: 'duda_medica' para CUALQUIER
// plantilla real matcheada del catálogo, o la categoría fija real
// (incluyendo 'duda_medica'/'sin_coincidencia' sin plantilla predeterminada
// propia — ver SLUG_PREDETERMINADO_POR_CATEGORIA) cuando Claude elige una
// de las 4 genéricas. 'emergencia'/'agendar_cita'/'resultados_laboratorio'
// TODAVÍA NO tienen ninguna acción real propia (no hay alerta a staff, ni
// parser de fecha/hora, ni lookup de laboratorio) — responden con la
// plantilla predeterminada del sistema de esa categoría, editable pero
// inborrable (migración 20260903000002). `cita_generada_id`/
// `registro_laboratorio_id` se quedan en null a propósito hasta que esas
// 3 fases se construyan.
const claude = require('../../config/claude');
const whatsapp = require('../../config/whatsapp');
const logger = require('../../config/logger');
const { normalizarFormatoWhatsapp } = require('../../../public/js/whatsapp-format');
const plantillasRepository = require('../plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('./whatsapp.repository');

const TELEFONO_CLINICA = '7711634578';

// Slugs fijos de las 4 plantillas predeterminadas del sistema (migración
// 20260903000002) — a diferencia de las demás (matcheadas por Claude
// contra su `intencion`), estas 4 solo entran cuando Claude elige una
// categoría genérica en vez de una intención específica del catálogo, y
// ahí se seleccionan de forma DETERMINISTA por categoria_clasificacion,
// nunca por el LLM.
const SLUG_EMERGENCIA = 'emergencia-medica';
const SLUG_AGENDAR_CITA = 'agendar-cita-default';
const SLUG_RESULTADOS_LABORATORIO = 'resultados-laboratorio-default';
const SLUG_SIN_COINCIDENCIA = 'sin-coincidencia-default';

// Último recurso si una plantilla predeterminada no existiera o estuviera
// inactiva — no debería pasar nunca (plantillas_whatsapp.service.js las
// protege: es_predeterminada las hace inborrables y no desactivables),
// pero una respuesta de WhatsApp jamás debe salir vacía.
const TEXTO_RESPALDO_ABSOLUTO = `Gracias por tu mensaje. Contáctanos directamente al ${TELEFONO_CLINICA} y con gusto te apoyamos.`;

// El campo `from` de un mensaje entrante de un celular mexicano llega como
// 521XXXXXXXXXX (con el "1" extra tras el 52, un resabio histórico de
// WhatsApp), pero la Graph API rechaza ese mismo número como destinatario
// al RESPONDER (error 131030 "Recipient phone number not in allowed
// list") — hay que mandar 52XXXXXXXXXX, sin el "1". Confirmado en vivo:
// Graph API normaliza el "to" de vuelta a wa_id 521... en su respuesta.
function normalizarNumeroSalida(telefono) {
  return telefono.replace(/^521(\d{10})$/, '52$1');
}

async function auditarEnvio(datos) {
  try {
    await repository.registrarEnvioWhatsapp(datos);
  } catch (err) {
    logger.error({ err }, 'No se pudo registrar la auditoría del envío de WhatsApp.');
  }
}

async function enviarRespuesta(telefono, texto, { plantillaId, plantilla }) {
  const destinatarioTelefono = normalizarNumeroSalida(telefono);
  const textoNormalizado = normalizarFormatoWhatsapp(texto);
  let res;
  let data;
  try {
    res = await fetch(whatsapp.messagesUrl(), {
      method: 'POST',
      headers: whatsapp.authHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destinatarioTelefono,
        type: 'text',
        text: { body: textoNormalizado },
      }),
    });
    data = typeof res.json === 'function' ? await res.json() : {};
  } catch (err) {
    await auditarEnvio({
      plantilla,
      plantillaId,
      destinatarioTelefono,
      exitoso: false,
      errorMensaje: err.message,
      origen: 'respuesta_automatica',
    });
    throw err;
  }

  if (!res.ok) {
    const error = new Error(data.error?.message || `Meta rechazó el envío (HTTP ${res.status}).`);
    await auditarEnvio({
      plantilla,
      plantillaId,
      destinatarioTelefono,
      exitoso: false,
      errorCodigo: data.error?.code ? String(data.error.code) : null,
      errorMensaje: error.message,
      origen: 'respuesta_automatica',
    });
    throw error;
  }

  await auditarEnvio({
    plantilla,
    plantillaId,
    destinatarioTelefono,
    exitoso: true,
    origen: 'respuesta_automatica',
  });
}

// Resuelve una de las 4 plantillas predeterminadas por su slug fijo —
// cuenta como uso real (incrementarUso) igual que una plantilla normal
// matcheada del catálogo, y su id sí viaja en `plantilla_id` de
// mensajes_whatsapp.
async function resolverPlantillaPredeterminada(slug) {
  const plantilla = await plantillasRepository.findBySlug(slug);
  if (!plantilla || !plantilla.activo) {
    return { texto: TEXTO_RESPALDO_ABSOLUTO, plantillaId: null, plantillaSlug: null };
  }
  await plantillasRepository.incrementarUso(plantilla.id);
  return {
    texto: plantilla.texto_respuesta,
    plantillaId: plantilla.id,
    plantillaSlug: plantilla.slug,
  };
}

// Slug de la plantilla predeterminada del sistema para cada categoría
// genérica — 'duda_medica' y 'sin_coincidencia' a propósito NO tienen
// entrada aquí (nunca tuvieron una plantilla predeterminada propia): caen
// al mismo respaldo `sin-coincidencia-default` vía el `??` de abajo, tal
// como ya ocurría antes de este rediseño.
const SLUG_PREDETERMINADO_POR_CATEGORIA = {
  emergencia: SLUG_EMERGENCIA,
  agendar_cita: SLUG_AGENDAR_CITA,
  resultados_laboratorio: SLUG_RESULTADOS_LABORATORIO,
};

async function procesarMensajeEntrante({ telefono, texto, recibidoEn }) {
  const plantillas = await plantillasRepository.findActivasParaClasificar();

  const { etiqueta, tokensEntrada, tokensSalida } = await claude.clasificarMensaje(
    texto,
    plantillas,
  );

  let respuesta;
  let plantillaId;
  let plantillaSlug;
  let categoriaGuardada;

  const plantillaDelCatalogo = plantillas.find((p) => p.intencion === etiqueta);
  if (plantillaDelCatalogo) {
    await plantillasRepository.incrementarUso(plantillaDelCatalogo.id);
    respuesta = plantillaDelCatalogo.texto_respuesta;
    plantillaId = plantillaDelCatalogo.id;
    plantillaSlug = plantillaDelCatalogo.slug;
    // Mismo valor que se guardaba antes para CUALQUIER plantilla real
    // matcheada del catálogo — no cambia el significado de esta columna
    // para reportes/métricas ya existentes.
    categoriaGuardada = 'duda_medica';
  } else {
    // Claude eligió una de las 4 categorías genéricas (o ninguna etiqueta
    // válida) en vez de una intención específica del catálogo.
    categoriaGuardada = etiqueta ?? claude.SIN_COINCIDENCIA;

    const slugPredeterminado = SLUG_PREDETERMINADO_POR_CATEGORIA[etiqueta] ?? SLUG_SIN_COINCIDENCIA;
    const resuelto = await resolverPlantillaPredeterminada(slugPredeterminado);
    respuesta = resuelto.texto;
    plantillaId = resuelto.plantillaId;
    plantillaSlug = resuelto.plantillaSlug;
  }

  let errorEnvio;
  try {
    await enviarRespuesta(telefono, respuesta, {
      plantillaId,
      plantilla: plantillaSlug ? plantillaSlug.replace(/-/g, '_') : 'respuesta_sin_plantilla',
    });
  } catch (err) {
    errorEnvio = err;
  }

  await repository.crearMensaje({
    telefonoOrigen: telefono,
    mensajeRecibido: texto,
    categoriaClasificacion: categoriaGuardada,
    plantillaId,
    citaGeneradaId: null,
    registroLaboratorioId: null,
    tokensEntrada,
    tokensSalida,
    recibidoEn,
  });

  if (errorEnvio) throw errorEnvio;
}

module.exports = { procesarMensajeEntrante };
