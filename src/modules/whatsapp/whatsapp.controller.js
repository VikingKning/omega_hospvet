const whatsapp = require('../../config/whatsapp');
const service = require('./whatsapp.service');
const outbox = require('./whatsapp.outbox');
const atencionHumanaService = require('./whatsapp.atencionHumana.service');
const alertasService = require('./whatsapp.alertas.service');

// Handshake de Meta al registrar el webhook (GET, una sola vez) — repite
// `hub.challenge` tal cual si `hub.verify_token` coincide con el valor que
// NOSOTROS configuramos (ver env.js), o rechaza con 403.
function verificar(req, res) {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (modo === 'subscribe' && whatsapp.esVerifyTokenValido(token)) {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.sendStatus(403);
}

// US WA 001 (AC7/AC8): ya no solo texto/imagen — CUALQUIER mensaje
// soportado se persiste, conservando su tipo original y lo mínimo
// necesario para procesarlo después. `contenido` es lo que eventualmente
// se manda a clasificar (Claude nunca ve una imagen/audio/video en sí,
// solo texto): el body de un texto, el caption de una foto, o el id de la
// opción elegida en una respuesta interactiva. Los tipos sin contenido de
// texto (imagen sin caption, audio, video, documento, sticker, ubicación,
// contacto, o cualquier otro no reconocido) se persisten con `contenido:
// null` — se guardan para una futura agrupación por conversación, pero
// nunca se mandan a Claude (ver whatsapp.repository.js#findPendientesParaProcesar).
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
  // US WA 014 (AC2): un documento con caption usa el caption como texto
  // procesable, igual que una imagen — antes caía en la rama genérica de
  // abajo con contenido:null sin importar el caption.
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
    // US WA 005 (consideración técnica): se extrae también el `title` —
    // nunca se decide la ruta con él (solo el id interno), pero queda
    // disponible para diagnóstico (ej. el log de una selección inválida).
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
  // US WA 014 (consideración técnica: conservar mime_type) — audio/video/
  // sticker nunca tienen caption en el schema de Meta (a diferencia de
  // imagen/documento), así que siempre contenido:null.
  if (['audio', 'video', 'sticker'].includes(mensaje.type)) {
    return {
      ...base,
      tipoMensaje: mensaje.type,
      contenido: null,
      mediaId: mensaje[mensaje.type]?.id ?? null,
      mimeType: mensaje[mensaje.type]?.mime_type ?? null,
    };
  }
  // location, contacts, o cualquier tipo que Meta agregue a futuro.
  return { ...base, tipoMensaje: mensaje.type ?? 'unknown', contenido: null, mediaId: null };
}

// `value.statuses` (recibos de entrega/lectura) nunca trae `messages` —
// AC6: un payload así no genera ningún evento, así que no se persiste
// nada ni se toca ninguna conversación.
function extraerEventosEntrantes(body) {
  const entradas = body?.entry ?? [];
  const eventos = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      // AC1/AC2: phone_number_id del número oficial de Omega que recibió
      // el mensaje — Meta siempre lo manda junto con value.messages.
      const phoneNumberId = cambio.value?.metadata?.phone_number_id ?? null;
      for (const mensaje of cambio.value?.messages ?? []) {
        eventos.push(extraerEventoDeMensaje(mensaje, phoneNumberId));
      }
    }
  }
  return eventos;
}

// US WA 015 (AC3): `value.statuses[]` es un arreglo separado de
// `value.messages[]` — Meta nunca los mezcla en el mismo payload. Cada
// estado se relaciona por wamid contra outbox_whatsapp, nunca contra
// mensajes_whatsapp/conversaciones_whatsapp (esto no es un mensaje del
// tutor ni debe activar el flujo conversacional).
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

// US WA 017 (AC25/AC35): `field=smb_message_echoes` con
// `value.message_echoes[]` — un mensaje que una
// PERSONA (no el bot) mandó desde la app o un dispositivo vinculado del
// número oficial de WhatsApp Business de Omega. Meta lo entrega como un
// arreglo propio dentro del mismo `value`, nunca mezclado con
// `messages`/`statuses`. ASUNCIÓN DE CONTENIDO (no hay forma de
// verificarlo sin un envío real desde la app): cada entrada tiene la misma
// forma que un mensaje normal, pero el destinatario (el tutor) viaja en
// `to`, no en `from` (`from` ahí es el propio número de Omega) — si Meta
// resulta usar otro nombre de campo, esto necesitará un ajuste puntual una
// vez confirmado en vivo.
function extraerEventosEcoEntrantes(body) {
  const entradas = body?.entry ?? [];
  const eventos = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      const phoneNumberId = cambio.value?.metadata?.phone_number_id ?? null;
      // Meta ha documentado/entregado esta suscripción con el nombre del
      // campo en `changes[].field` y los elementos dentro de
      // `value.message_echoes`; se conserva además la forma anterior para
      // tolerar fixtures y versiones ya observadas.
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

// Recepción real de mensajes (POST). Verifica la firma ANTES que nada —
// 401 si no coincide (AC12: nunca se persiste ni se procesa nada sin
// firma real de Meta). Con firma válida, PERSISTE cada evento y responde
// 200 en cuanto termina — nunca clasifica ni envía nada desde aquí (US WA
// 003 AC4/AC9: la clasificación solo ocurre DESPUÉS de que venza la
// ventana de agrupación de la conversación y whatsappAgrupacionJob.js
// forme el grupo; antes de esta historia, un disparo fire-and-forget
// clasificaba/respondía casi al instante, lo que le ganaba en tiempo a
// cualquier ventana de agrupación — se quitó a propósito).
//
// Cada evento se persiste con su propio INSERT, nunca dentro de una
// transacción que envuelva todo el lote (AC3: "cada uno se registra de
// manera independiente"): si el evento N de un lote de varios falla por un
// error real de BD, los anteriores ya quedaron committeados, y el
// reintento de Meta del lote completo vuelve a intentar solo el que faltó
// (los demás son no-ops gracias al ON CONFLICT). Un error real de BD (no
// un conflicto de duplicado, eso no es un error) responde con un código
// distinto de 200 para que Meta reintregue el evento (AC11).
async function recibir(req, res) {
  const firmaValida = whatsapp.verificarFirma(req.rawBody, req.get('X-Hub-Signature-256'));
  if (!firmaValida) {
    return res.sendStatus(401);
  }

  const eventos = extraerEventosEntrantes(req.body);
  const estados = extraerEstadosEntrantes(req.body);

  try {
    for (const evento of eventos) {
      // WA018 AC36: una respuesta explícita a una plantilla interna para el
      // personal se reconoce por context.id -> outbox.wamid y se excluye
      // por completo del router conversacional del tutor.
      if (
        evento.contextWamid &&
        (await alertasService.esRespuestaAAlertaInterna(evento.contextWamid))
      ) {
        continue;
      }
      const resultado = await service.registrarEventoEntrante(evento);
      // US WA 004 (AC2): un comando de menú sobre una conversación YA
      // existente cancela su flujo/estado de inmediato (WA002, sin
      // cambios) — pero "mostrar el menú" implica llamar a Meta, lo cual
      // nunca se hace dentro del ciclo síncrono del webhook; se dispara
      // fire-and-forget, sin bloquear la respuesta 200.
      // US WA 013 (AC2/AC3/AC5): el tutor respondió a una pregunta de
      // seguimiento pendiente. 'volver_menu' se trata igual que un comando
      // de menú explícito (mismo destino, enviarMenuPrincipal). 'continuar'
      // solo tiene contenido real que reenviar si el paso pendiente era el
      // menú (esperando_menu) — para flujo_activo no existe hoy ningún paso
      // real que reconstruir (ningún flujo lo popula todavía), así que no
      // hay nada que reenviar. 'invalido' repite la misma pregunta.
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
        // US WA 005 (AC9): id de menú desconocido, manipulado o vencido.
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
        // US WA 006: respuesta determinista con el enlace público correcto
        // o transferencia a Recepción si su variable no es una URL HTTPS.
        // Nunca pasa por el clasificador de Claude.
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
        // US WA 007: cualquier paso del flujo de consulta de laboratorio.
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
        // US WA 009 (AC1-AC3): MENU_EMERGENCIA disparó "Por favor,
        // descríbenos cuál es tu emergencia." — el envío es fire-and-forget
        // (nunca bloquea el 200 del webhook), mismo criterio que el resto
        // de estas ramas.
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
    // US WA 017 (AC25-AC31/AC34/AC35): mensaje manual del personal de Omega.
    for (const echo of extraerEventosEcoEntrantes(req.body)) {
      // AC34: un evento saliente que no se puede correlacionar (aquí, uno
      // sin los campos mínimos para identificarlo como eco real) nunca se
      // asume enviado por una persona — se registra la anomalía y se
      // conserva el estado actual, sin tocar nada.
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
