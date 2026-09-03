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
// con un texto de respaldo honesto, nunca fingen haber hecho algo que no
// pasó. `cita_generada_id`/`registro_laboratorio_id` se quedan en null a
// propósito hasta que esas 3 fases se construyan.
const claude = require('../../config/claude');
const whatsapp = require('../../config/whatsapp');
const plantillasRepository = require('../plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('./whatsapp.repository');

const TELEFONO_CLINICA = '7711634578';

const TEXTO_EMERGENCIA =
  `Recibimos tu mensaje y detectamos que podría tratarse de una urgencia. ` +
  `Un miembro del equipo se pondrá en contacto contigo lo antes posible. ` +
  `Si es una urgencia real, por favor llama de inmediato al ${TELEFONO_CLINICA} o acude directamente a la clínica.`;

const TEXTO_AGENDAR_CITA =
  `Gracias por escribirnos. Por el momento, para agendar, mover o cancelar una cita ` +
  `contáctanos directamente al ${TELEFONO_CLINICA} y con gusto te ayudamos.`;

const TEXTO_RESULTADOS_LABORATORIO =
  `Gracias por escribirnos. Para consultar el estado de tus resultados de laboratorio, ` +
  `contáctanos al ${TELEFONO_CLINICA} y con gusto te apoyamos.`;

const TEXTO_SIN_COINCIDENCIA = `Gracias por tu mensaje. Para poder ayudarte mejor, contáctanos directamente al ${TELEFONO_CLINICA}.`;

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
    // cubre el catch-all real dentro de esta categoría — este texto solo
    // se usa si ni siquiera esa encajó.
    return { texto: TEXTO_SIN_COINCIDENCIA, plantillaId: null, tokensEntrada, tokensSalida };
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
  let plantillaId = null;
  let categoriaGuardada = categoria.etiqueta ?? claude.SIN_COINCIDENCIA;

  if (categoria.etiqueta === 'duda_medica') {
    const resuelto = await resolverDudaMedica(texto);
    respuesta = resuelto.texto;
    plantillaId = resuelto.plantillaId;
    tokensEntrada += resuelto.tokensEntrada;
    tokensSalida += resuelto.tokensSalida;
  } else if (categoria.etiqueta === 'emergencia') {
    respuesta = TEXTO_EMERGENCIA;
  } else if (categoria.etiqueta === 'agendar_cita') {
    respuesta = TEXTO_AGENDAR_CITA;
  } else if (categoria.etiqueta === 'resultados_laboratorio') {
    respuesta = TEXTO_RESULTADOS_LABORATORIO;
  } else {
    respuesta = TEXTO_SIN_COINCIDENCIA;
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
