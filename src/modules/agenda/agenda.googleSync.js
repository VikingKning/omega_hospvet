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
    extendedProperties: { private: { citaId: String(cita.id) } },
  };
}

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

async function sincronizar() {
  if (!isGoogleSyncConfigured()) {
    logger.debug('Google Calendar sync no configurado, se omite el ciclo.');
    return;
  }

  const ahora = new Date();

  const pendientes = await repository.findPendientesDePush(ahora);
  for (const { id } of pendientes) {
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
    const citasImportadasEsteCiclo = new Set();
    for (const evento of data.items ?? []) {
      const citaId = evento.extendedProperties?.private?.citaId;
      if (citaId) {
        eventosPorCitaId.set(Number(citaId), evento);
        continue;
      }
      const nuevaCitaId = await importarReserva(evento);
      if (nuevaCitaId) {
        citasImportadasEsteCiclo.add(nuevaCitaId);
        await pushCita(nuevaCitaId);
      }
    }

    const sincronizadas = await repository.findSincronizadasFuturas(ahora);
    for (const cita of sincronizadas) {
      if (citasImportadasEsteCiclo.has(cita.id)) continue;

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
