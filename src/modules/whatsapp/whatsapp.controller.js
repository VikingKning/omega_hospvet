const whatsapp = require('../../config/whatsapp');
const service = require('./whatsapp.service');
const outbox = require('./whatsapp.outbox');
const atencionHumanaService = require('./whatsapp.atencionHumana.service');
const alertasService = require('./whatsapp.alertas.service');
const configuracionService = require('../configuracion/configuracion.service');

function verificar(req, res) {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (modo === 'subscribe' && whatsapp.esVerifyTokenValido(token)) {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.sendStatus(403);
}

function extraerEventoDeMensaje(mensaje, phoneNumberId) {
  const base = {
    whatsappMessageId: mensaje.id,
    from: mensaje.from,
    timestamp: mensaje.timestamp,
    phoneNumberId,
    ...(mensaje.context?.id ? { contextWamid: mensaje.context.id } : {}),
  };

  if (mensaje.type === 'text') {
    return { ...base, tipoMensaje: 'text', contenido: mensaje.text?.body ?? null, mediaId: null };
  }
  if (mensaje.type === 'image') {
    return {
      ...base,
      tipoMensaje: 'image',
      contenido: mensaje.image?.caption ?? null,
      mediaId: mensaje.image?.id ?? null,
      mimeType: mensaje.image?.mime_type ?? null,
    };
  }
  if (mensaje.type === 'document') {
    return {
      ...base,
      tipoMensaje: 'document',
      contenido: mensaje.document?.caption ?? null,
      mediaId: mensaje.document?.id ?? null,
      mimeType: mensaje.document?.mime_type ?? null,
    };
  }
  if (mensaje.type === 'interactive') {
    const interactivo = mensaje.interactive ?? {};
    if (interactivo.type === 'list_reply') {
      return {
        ...base,
        tipoMensaje: 'interactive_list_reply',
        contenido: interactivo.list_reply?.id ?? null,
        mediaId: null,
        tituloInteractivo: interactivo.list_reply?.title ?? null,
      };
    }
    if (interactivo.type === 'button_reply') {
      return {
        ...base,
        tipoMensaje: 'interactive_button_reply',
        contenido: interactivo.button_reply?.id ?? null,
        mediaId: null,
        tituloInteractivo: interactivo.button_reply?.title ?? null,
      };
    }
    return { ...base, tipoMensaje: 'unknown', contenido: null, mediaId: null };
  }
  if (['audio', 'video', 'sticker'].includes(mensaje.type)) {
    return {
      ...base,
      tipoMensaje: mensaje.type,
      contenido: null,
      mediaId: mensaje[mensaje.type]?.id ?? null,
      mimeType: mensaje[mensaje.type]?.mime_type ?? null,
    };
  }
  return { ...base, tipoMensaje: mensaje.type ?? 'unknown', contenido: null, mediaId: null };
}

function extraerEventosEntrantes(body) {
  const entradas = body?.entry ?? [];
  const eventos = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      const phoneNumberId = cambio.value?.metadata?.phone_number_id ?? null;
      for (const mensaje of cambio.value?.messages ?? []) {
        eventos.push(extraerEventoDeMensaje(mensaje, phoneNumberId));
      }
    }
  }
  return eventos;
}

function extraerEstadosEntrantes(body) {
  const entradas = body?.entry ?? [];
  const estados = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      for (const status of cambio.value?.statuses ?? []) {
        estados.push({ wamid: status.id, estadoMeta: status.status });
      }
    }
  }
  return estados;
}

function extraerEventosEcoEntrantes(body) {
  const entradas = body?.entry ?? [];
  const eventos = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      const phoneNumberId = cambio.value?.metadata?.phone_number_id ?? null;
      const ecosCandidatos = [
        ...(cambio.value?.message_echoes ?? []),
        ...(cambio.value?.smb_message_echoes ?? []),
      ];
      const ecos = ecosCandidatos.filter(
        (echo, indice) =>
          !echo?.id ||
          ecosCandidatos.findIndex((candidato) => candidato?.id === echo.id) === indice,
      );
      for (const echo of ecos) {
        eventos.push({
          whatsappMessageId: echo.id,
          telefonoTutor: echo.to,
          tipoMensaje: echo.type ?? 'unknown',
          timestamp: echo.timestamp,
          phoneNumberId,
        });
      }
    }
  }
  return eventos;
}

async function recibir(req, res) {
  const firmaValida = whatsapp.verificarFirma(req.rawBody, req.get('X-Hub-Signature-256'));
  if (!firmaValida) {
    return res.sendStatus(401);
  }

  let funcionesWhatsapp;
  try {
    funcionesWhatsapp = await configuracionService.obtenerConfiguracionWhatsapp();
  } catch (err) {
    req.log.error({ err }, 'No se pudo consultar la configuración de WhatsApp.');
    return res.sendStatus(503);
  }
  if (!funcionesWhatsapp.respuestasAutomaticas) {
    return res.sendStatus(200);
  }

  const eventos = extraerEventosEntrantes(req.body);
  const estados = extraerEstadosEntrantes(req.body);

  try {
    for (const evento of eventos) {
      if (
        evento.contextWamid &&
        (await alertasService.esRespuestaAAlertaInterna(evento.contextWamid))
      ) {
        continue;
      }
      const resultado = await service.registrarEventoEntrante({
        ...evento,
        funcionesWhatsapp,
      });
      if (resultado?.pipelineAsignado === 'flujo_anterior') {
        if (resultado.esNuevo) {
          service.procesarSiguienteMensajeFlujoAnterior().catch((err) =>
            req.log.error(
              {
                err,
                whatsappMessageId: evento.whatsappMessageId,
                pipeline: 'flujo_anterior',
              },
              'Falló el procesamiento individual del flujo anterior.',
            ),
          );
        }
        continue;
      }
      if (resultado?.disparaMenuInmediato || resultado?.seguimientoAccion === 'volver_menu') {
        service
          .enviarMenuPrincipal({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            claveBase: `mensaje:${resultado.id}`,
          })
          .catch((err) =>
            req.log.error({ err }, 'Falló el envío inmediato del menú tras un comando de menú.'),
          );
      } else if (
        resultado?.seguimientoAccion === 'continuar' &&
        resultado.estadoResultante === 'esperando_menu'
      ) {
        service
          .enviarMenuPrincipal({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            claveBase: `mensaje:${resultado.id}`,
          })
          .catch((err) =>
            req.log.error({ err }, 'Falló el reenvío del menú tras "Continuar" (US WA 013 AC2).'),
          );
      } else if (
        resultado?.seguimientoAccion === 'continuar' &&
        resultado.estadoResultante === 'flujo_activo'
      ) {
        service
          .reanudarFlujoPendiente({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            mensajeId: resultado.id,
            flujoActual: resultado.flujoActualResultante,
            pasoActual: resultado.pasoActualResultante,
          })
          .catch((err) =>
            req.log.error({ err }, 'Falló la reanudación del flujo activo (US WA 013 AC2).'),
          );
      } else if (resultado?.seguimientoAccion === 'invalido') {
        service
          .reenviarSeguimiento({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            mensajeId: resultado.id,
          })
          .catch((err) =>
            req.log.error(
              { err },
              'Falló el reenvío de la pregunta de seguimiento (US WA 013 AC5).',
            ),
          );
      } else if (resultado?.seleccionInvalida) {
        service
          .enviarSeleccionInvalida({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            mensajeId: resultado.id,
          })
          .catch((err) =>
            req.log.error({ err }, 'Falló el aviso de selección de menú inválida (US WA 005 AC9).'),
          );
      } else if (
        resultado?.rutaResuelta === 'agendar_consulta' ||
        resultado?.rutaResuelta === 'agendar_estetica'
      ) {
        service
          .enviarEnlaceAgenda({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            claveBase: `mensaje:${resultado.id}`,
            ruta: resultado.rutaResuelta,
          })
          .catch((err) =>
            req.log.error({ err }, 'Falló el procesamiento de una ruta de agenda (US WA 006).'),
          );
      } else if (resultado?.labAccion) {
        service
          .enviarPasoLaboratorio({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            mensajeId: resultado.id,
            labAccion: resultado.labAccion,
            labDatos: resultado.labDatos,
          })
          .catch((err) =>
            req.log.error(
              { err },
              'Falló el envío de un paso de consulta de laboratorio (US WA 007).',
            ),
          );
      } else if (resultado?.disparaSolicitudEmergencia) {
        service
          .enviarSolicitudEmergencia({
            conversacionId: resultado.conversacionId,
            telefono: resultado.telefonoNormalizado,
            claveBase: `mensaje:${resultado.id}`,
          })
          .catch((err) =>
            req.log.error(
              { err },
              'Falló el envío de la solicitud de descripción de emergencia (US WA 009 AC1).',
            ),
          );
      }
    }
    for (const estadoEvento of estados) {
      await outbox.registrarEstadoMeta(estadoEvento);
    }
    for (const echo of extraerEventosEcoEntrantes(req.body)) {
      if (
        !echo.whatsappMessageId ||
        !echo.telefonoTutor ||
        !echo.phoneNumberId ||
        !echo.timestamp
      ) {
        req.log.warn(
          { echo },
          'smb_message_echoes con campos incompletos; se ignora (US WA 017 AC34).',
        );
        continue;
      }
      await atencionHumanaService.registrarEchoManual({
        whatsappMessageId: echo.whatsappMessageId,
        telefonoTutor: echo.telefonoTutor,
        phoneNumberId: echo.phoneNumberId,
        tipoMensaje: echo.tipoMensaje,
        recibidoEn: new Date(Number(echo.timestamp) * 1000),
      });
    }
  } catch (err) {
    req.log.error({ err }, 'Error de BD al persistir mensajes entrantes de WhatsApp.');
    return res.sendStatus(503);
  }

  return res.sendStatus(200);
}

module.exports = {
  verificar,
  recibir,
  extraerEventosEntrantes,
  extraerEstadosEntrantes,
  extraerEventosEcoEntrantes,
};
