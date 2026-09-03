// Procesa un mensaje entrante de WhatsApp (whatsapp.controller.js#recibir)
// — clasificación de 2 niveles (Bitácora v4 + sección 1.3 del documento
// funcional, ver el plan de esta ronda): 1ro `categoria_clasificacion` (1
// de 4 fijas), y SOLO dentro de 'duda_medica' un 2do nivel contra las
// `plantillas_whatsapp.intencion` activas (ya construido y verificado en
// vivo antes de este módulo).
//
// Alcance de esta ronda (pedido explícito del usuario: "hacer la
// prueba"): 'duda_medica' queda completo de verdad (responde con el
// texto_respuesta real de la plantilla que matcheó). 'emergencia'/
// 'agendar_cita'/'resultados_laboratorio' TODAVÍA NO tienen ninguna acción
// real (no hay mecanismo de alerta a staff, ni parser de fecha/hora para
// agendar, ni lookup de registro de laboratorio por teléfono) — responden
// con la plantilla predeterminada del sistema de esa categoría (pedido
// explícito del usuario: antes eran textos fijos en este archivo, ahora
// son 4 filas editables — pero inborrables — en `plantillas_whatsapp`,
// ver la migración 20260903000002). `cita_generada_id`/
// `registro_laboratorio_id` se quedan en null a propósito hasta que esas 3
// fases se construyan.
const claude = require('../../config/claude');
const whatsapp = require('../../config/whatsapp');
const plantillasRepository = require('../plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('./whatsapp.repository');

const TELEFONO_CLINICA = '7711634578';

// Slugs fijos de las 4 plantillas predeterminadas del sistema (migración
// 20260903000002) — a diferencia de las 9 normales (matcheadas por Claude
// contra su `intencion` dentro de duda_medica), estas 4 se seleccionan de
// forma DETERMINISTA por categoria_clasificacion, nunca por el LLM.
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

async function enviarRespuesta(telefono, texto) {
  await fetch(whatsapp.messagesUrl(), {
    method: 'POST',
    headers: whatsapp.authHeaders(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizarNumeroSalida(telefono),
      type: 'text',
      text: { body: texto },
    }),
  });
}

// Resuelve una de las 4 plantillas predeterminadas por su slug fijo —
// cuenta como uso real (incrementarUso) igual que una plantilla normal
// matcheada dentro de duda_medica, y su id sí viaja en `plantilla_id` de
// mensajes_whatsapp (a diferencia de antes, cuando estos 3 textos ni
// siquiera eran una plantilla real que se pudiera enlazar).
async function resolverPlantillaPredeterminada(slug) {
  const plantilla = await plantillasRepository.findBySlug(slug);
  if (!plantilla || !plantilla.activo) {
    return { texto: TEXTO_RESPALDO_ABSOLUTO, plantillaId: null };
  }
  await plantillasRepository.incrementarUso(plantilla.id);
  return { texto: plantilla.texto_respuesta, plantillaId: plantilla.id };
}

// Segundo nivel — solo se llama dentro de la rama 'duda_medica'. Regresa
// { texto, plantillaId, tokensEntrada, tokensSalida }.
async function resolverDudaMedica(mensaje) {
  const plantillas = await plantillasRepository.findActivasParaClasificar();
  const intenciones = plantillas.map((p) => p.intencion);

  const { etiqueta, tokensEntrada, tokensSalida } = await claude.clasificarIntencion(
    mensaje,
    intenciones,
  );

  const plantilla = plantillas.find((p) => p.intencion === etiqueta);
  if (!plantilla) {
    // Defensivo: en teoría 'duda_medica_general' (una de las 9 activas) ya
    // cubre el catch-all real dentro de esta categoría — esto solo se usa
    // si ni siquiera esa encajó.
    const resuelto = await resolverPlantillaPredeterminada(SLUG_SIN_COINCIDENCIA);
    return {
      texto: resuelto.texto,
      plantillaId: resuelto.plantillaId,
      tokensEntrada,
      tokensSalida,
    };
  }

  await plantillasRepository.incrementarUso(plantilla.id);
  return {
    texto: plantilla.texto_respuesta,
    plantillaId: plantilla.id,
    tokensEntrada,
    tokensSalida,
  };
}

async function procesarMensajeEntrante({ telefono, texto, recibidoEn }) {
  const categoria = await claude.clasificarCategoria(texto);
  let tokensEntrada = categoria.tokensEntrada;
  let tokensSalida = categoria.tokensSalida;

  let respuesta;
  let plantillaId;
  let categoriaGuardada = categoria.etiqueta ?? claude.SIN_COINCIDENCIA;

  if (categoria.etiqueta === 'duda_medica') {
    const resuelto = await resolverDudaMedica(texto);
    respuesta = resuelto.texto;
    plantillaId = resuelto.plantillaId;
    tokensEntrada += resuelto.tokensEntrada;
    tokensSalida += resuelto.tokensSalida;
  } else if (categoria.etiqueta === 'emergencia') {
    const resuelto = await resolverPlantillaPredeterminada(SLUG_EMERGENCIA);
    respuesta = resuelto.texto;
    plantillaId = resuelto.plantillaId;
  } else if (categoria.etiqueta === 'agendar_cita') {
    const resuelto = await resolverPlantillaPredeterminada(SLUG_AGENDAR_CITA);
    respuesta = resuelto.texto;
    plantillaId = resuelto.plantillaId;
  } else if (categoria.etiqueta === 'resultados_laboratorio') {
    const resuelto = await resolverPlantillaPredeterminada(SLUG_RESULTADOS_LABORATORIO);
    respuesta = resuelto.texto;
    plantillaId = resuelto.plantillaId;
  } else {
    const resuelto = await resolverPlantillaPredeterminada(SLUG_SIN_COINCIDENCIA);
    respuesta = resuelto.texto;
    plantillaId = resuelto.plantillaId;
  }

  await enviarRespuesta(telefono, respuesta);

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
}

module.exports = { procesarMensajeEntrante };
