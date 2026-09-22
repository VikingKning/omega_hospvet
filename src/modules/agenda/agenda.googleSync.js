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
      try {
        await calendar.events.update({
          calendarId,
          eventId: cita.google_event_id,
          requestBody: evento,
        });
        await repository.marcarSincronizado(citaId, cita.google_event_id);
        return;
      } catch (err) {
        // El id guardado puede no pertenecer a ESTE calendario — pasa con
        // una reserva externa importada desde otro calendario que el token
        // también puede ver (pedido explícito del usuario, 2026-09-22: se
        // recogen reservas sin importar en qué calendario aterricen). Se
        // crea el evento propio aquí, como si fuera de alta.
        if (!esErrorEventoInexistente(err)) throw err;
      }
    }

    const { data } = await calendar.events.insert({ calendarId, requestBody: evento });
    await repository.marcarSincronizado(citaId, data.id);
  } catch (err) {
    logger.error(
      { err, citaId },
      'No se pudo sincronizar la cita con Google Calendar; se reintentará en el siguiente ciclo.',
    );
  }
}

// Trae TODOS los eventos futuros de un calendario, siguiendo nextPageToken
// (Google entrega máximo 250 por página y no los junta sola).
async function listarEventosFuturos(calendar, calendarId, ahora) {
  const items = [];
  let pageToken;
  do {
    const { data } = await calendar.events.list({
      calendarId,
      timeMin: ahora.toISOString(),
      singleEvents: true,
      showDeleted: false,
      pageToken,
    });
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

// Reservas externas (páginas de reservas de Google) pueden aterrizar en
// CUALQUIER calendario que el token de la clínica también pueda ver — no
// solo el principal (pedido explícito del usuario, 2026-09-22: no depender
// de un calendario fijo). Se revisan aparte, nunca se mezclan con la
// reconciliación por citaId de sincronizar(), que sigue siendo solo del
// calendario principal.
async function importarReservasDeCalendariosAdicionales(calendar, ahora) {
  const citasImportadas = [];
  try {
    const { data } = await calendar.calendarList.list();
    const otrosCalendarios = (data.items ?? [])
      .map((c) => c.id)
      .filter((id) => id && id !== env.google.calendarId);

    for (const calendarId of otrosCalendarios) {
      const eventos = await listarEventosFuturos(calendar, calendarId, ahora);
      for (const evento of eventos) {
        if (evento.extendedProperties?.private?.citaId) continue;
        const nuevaCitaId = await importarReserva(evento);
        if (nuevaCitaId) citasImportadas.push(nuevaCitaId);
      }
    }
  } catch (err) {
    logger.error({ err }, 'No se pudieron revisar calendarios adicionales para reservas externas.');
  }
  return citasImportadas;
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
    // Google trae como máximo 250 eventos por página y NO las junta sola —
    // sin seguir nextPageToken, un calendario con más de 250 citas futuras
    // (nada raro para 8 áreas compartiendo uno solo, sin timeMax) deja
    // eventos reales fuera del mapa de abajo, y se interpretan como
    // cancelados en Google cuando siguen perfectamente vigentes (bug real
    // reportado 2026-09-22).
    const items = await listarEventosFuturos(calendar, env.google.calendarId, ahora);

    const eventosPorCitaId = new Map();
    const citasImportadasEsteCiclo = new Set();
    for (const evento of items) {
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

    const importadasDeOtrosCalendarios = await importarReservasDeCalendariosAdicionales(
      calendar,
      ahora,
    );
    for (const nuevaCitaId of importadasDeOtrosCalendarios) {
      citasImportadasEsteCiclo.add(nuevaCitaId);
      await pushCita(nuevaCitaId);
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
