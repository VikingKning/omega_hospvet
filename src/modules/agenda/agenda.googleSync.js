// Sincronización con Google Calendar — pedido explícito del usuario: push
// inmediato (best-effort, nunca bloquea al usuario) al crear/editar/
// cancelar una cita, más un pull periódico (job en src/jobs/) que revisa
// Google Calendar y refleja acá cancelaciones/reagendados hechos directo
// ahí, Y (agregado después, ver agenda.reservasExternas.js) importa
// reservas nuevas hechas por el cliente vía la página de reservas de
// Google Calendar de Consultas — el resto de eventos creados directo en
// Google (sin la señal de ese formulario) se siguen ignorando por
// completo, sigue sin haber forma de mapearlos a doctor/mascota/área.
// Una sola cuenta/calendario para las 8 áreas, distinguidas por el
// colorId del evento (areas.color_google_calendar YA es ese colorId
// real).
const logger = require('../../config/logger');
const { getCalendarClient, isGoogleSyncConfigured } = require('../../config/googleCalendar');
const env = require('../../config/env');
const repository = require('./agenda.repository');
const { findColor } = require('../areas/googleCalendarColors');
const { importarReserva } = require('./agenda.reservasExternas');

function esErrorEventoInexistente(err) {
  const status = err.code ?? err.response?.status;
  return status === 404 || status === 410;
}

function eventoDesdeCita(cita) {
  const inicio = new Date(cita.fecha_hora_inicio);
  const fin = new Date(inicio.getTime() + cita.duracion_minutos * 60000);
  const color = findColor(cita.color_google_calendar);
  return {
    summary: `${cita.mascota_nombre} — ${cita.doctor_apellidos}, ${cita.doctor_nombre}`,
    description: cita.motivo || undefined,
    start: { dateTime: inicio.toISOString() },
    end: { dateTime: fin.toISOString() },
    colorId: color.id ?? undefined,
    // Único dato que le permite al pull reconocer "este evento lo creamos
    // nosotros" sin depender de ya tener google_event_id guardado de este
    // lado — un evento de Google sin esto se ignora por completo.
    extendedProperties: { private: { citaId: String(cita.id) } },
  };
}

// Alta/edición/cancelación → intenta reflejarlo en Google. Nunca lanza: un
// error se loguea y la cita queda tal cual (el siguiente ciclo del job la
// vuelve a intentar vía repository.findPendientesDePush).
async function pushCita(citaId) {
  if (!isGoogleSyncConfigured()) {
    logger.debug('Google Calendar sync no configurado, se omite el push.');
    return;
  }

  try {
    const cita = await repository.findByIdParaSync(citaId);
    if (!cita) return;

    const calendar = getCalendarClient();
    const calendarId = env.google.calendarId;

    if (cita.estado === 'cancelada') {
      if (cita.google_event_id) {
        try {
          await calendar.events.delete({ calendarId, eventId: cita.google_event_id });
        } catch (err) {
          // Ya no existe en Google (alguien lo borró allá primero) — no es
          // una falla real, ya se llegó al estado deseado.
          if (!esErrorEventoInexistente(err)) throw err;
        }
      }
      await repository.marcarSincronizado(citaId, cita.google_event_id);
      return;
    }

    const evento = eventoDesdeCita(cita);
    if (cita.google_event_id) {
      await calendar.events.update({
        calendarId,
        eventId: cita.google_event_id,
        requestBody: evento,
      });
      await repository.marcarSincronizado(citaId, cita.google_event_id);
    } else {
      const { data } = await calendar.events.insert({ calendarId, requestBody: evento });
      await repository.marcarSincronizado(citaId, data.id);
    }
  } catch (err) {
    logger.error(
      { err, citaId },
      'No se pudo sincronizar la cita con Google Calendar; se reintentará en el siguiente ciclo.',
    );
  }
}

// Job periódico (src/jobs/googleCalendarSyncJob.js): 1) empuja todo lo
// pendiente, 2) revisa Google y refleja cancelaciones/reagendados hechos
// directo ahí. Alcance temporal: solo citas de HOY en adelante (pedido
// explícito del usuario) — nunca toca el pasado.
async function sincronizar() {
  if (!isGoogleSyncConfigured()) {
    logger.debug('Google Calendar sync no configurado, se omite el ciclo.');
    return;
  }

  const ahora = new Date();

  const pendientes = await repository.findPendientesDePush(ahora);
  for (const { id } of pendientes) {
    // Secuencial a propósito, no bombardear la API de Google en ráfaga.
    await pushCita(id);
  }

  try {
    const calendar = getCalendarClient();
    const { data } = await calendar.events.list({
      calendarId: env.google.calendarId,
      timeMin: ahora.toISOString(),
      singleEvents: true,
      showDeleted: false,
    });

    const eventosPorCitaId = new Map();
    // Bug real encontrado en vivo: eventosPorCitaId es un snapshot de
    // ANTES de que exista cualquier cita que se importe en este mismo
    // ciclo — aunque importarReserva()+pushCita() la etiqueten con
    // citaId en Google en el momento, ese cambio nunca aparece en ESTE
    // snapshot ya tomado. Sin este Set, la reconciliación de abajo
    // concluía "esta cita tiene google_event_id pero no aparece en el
    // snapshot -> debió borrarse en Google" y la cancelaba sola, en el
    // mismo ciclo en el que se acababa de crear.
    const citasImportadasEsteCiclo = new Set();
    for (const evento of data.items ?? []) {
      const citaId = evento.extendedProperties?.private?.citaId;
      if (citaId) {
        eventosPorCitaId.set(Number(citaId), evento);
        continue;
      }
      // Sin citaId: no lo creamos nosotros. Puede ser una reserva de la
      // página de Consultas (importarReserva reconoce la señal del
      // formulario y la ignora en silencio si no aplica) — secuencial,
      // mismo criterio que el resto del ciclo, y nunca lanza.
      const nuevaCitaId = await importarReserva(evento);
      if (nuevaCitaId) {
        citasImportadasEsteCiclo.add(nuevaCitaId);
        await pushCita(nuevaCitaId);
      }
    }

    const sincronizadas = await repository.findSincronizadasFuturas(ahora);
    for (const cita of sincronizadas) {
      if (citasImportadasEsteCiclo.has(cita.id)) continue;

      // Conflicto: si ya hay una edición local sin sincronizar todavía
      // (más reciente que el último sync), esa gana — findPendientesDePush
      // ya se encarga de reempujarla, no se toca nada aquí.
      const localGanaConflicto =
        Boolean(cita.actualizado_en) && cita.actualizado_en > cita.google_sincronizado_en;
      if (localGanaConflicto) continue;

      const evento = eventosPorCitaId.get(cita.id);

      if (!evento || evento.status === 'cancelled') {
        await repository.aplicarCancelacionDesdeGoogle(cita.id);
        continue;
      }

      const inicioGoogle = evento.start?.dateTime ? new Date(evento.start.dateTime) : null;
      const finGoogle = evento.end?.dateTime ? new Date(evento.end.dateTime) : null;
      const cambioDeHorario =
        inicioGoogle &&
        finGoogle &&
        inicioGoogle.getTime() !== new Date(cita.fecha_hora_inicio).getTime();

      if (cambioDeHorario) {
        const duracionMinutos = Math.round((finGoogle.getTime() - inicioGoogle.getTime()) / 60000);
        await repository.aplicarReagendoDesdeGoogle(cita.id, {
          fechaHoraInicio: inicioGoogle,
          duracionMinutos,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'No se pudo revisar Google Calendar en este ciclo de sincronización.');
  }
}

module.exports = { pushCita, sincronizar };
