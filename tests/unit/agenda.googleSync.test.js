// Sincronización con Google Calendar — el cliente real de Google y el
// repository se mockean por completo, nunca se pega a la red real (mismo
// criterio que el resto de los tests unitarios del proyecto).
jest.mock('../../src/modules/agenda/agenda.repository');
jest.mock('../../src/modules/agenda/agenda.reservasExternas');
jest.mock('../../src/modules/doctores/doctores.repository');
jest.mock('../../src/config/googleCalendar');
jest.mock('../../src/config/env', () => ({
  ...jest.requireActual('../../src/config/env'),
  google: { calendarId: 'test-calendar-id', syncIntervalMinutes: 10 },
}));

const repository = require('../../src/modules/agenda/agenda.repository');
const { importarReserva } = require('../../src/modules/agenda/agenda.reservasExternas');
const { getCalendarClient, isGoogleSyncConfigured } = require('../../src/config/googleCalendar');
const { pushCita, sincronizar } = require('../../src/modules/agenda/agenda.googleSync');
const agendaService = require('../../src/modules/agenda/agenda.service');
const doctoresRepository = require('../../src/modules/doctores/doctores.repository');

const CITA_NUEVA = {
  id: 1,
  fecha_hora_inicio: '2026-09-01T15:00:00.000Z',
  duracion_minutos: 30,
  motivo: 'Revisión',
  estado: 'confirmada',
  google_event_id: null,
  mascota_nombre: 'Nissa',
  doctor_nombre: 'Jimmy',
  doctor_apellidos: 'LoAng',
  color_google_calendar: '7',
};

function fakeCalendar() {
  return {
    events: {
      insert: jest.fn().mockResolvedValue({ data: { id: 'google-evt-1' } }),
      update: jest.fn().mockResolvedValue({}),
      patch: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue({ data: { items: [] } }),
    },
    calendarList: {
      list: jest.fn().mockResolvedValue({ data: { items: [] } }),
    },
  };
}

// Simula el contrato de Google: PUT sustituye el recurso completo y PATCH
// conserva los campos omitidos. No se envían invitaciones ni correos reales.
function fakeCalendarConReserva(reservaOriginal) {
  const calendar = fakeCalendar();
  let reserva = structuredClone(reservaOriginal);
  calendar.events.update.mockImplementation(async ({ requestBody }) => {
    reserva = { id: reserva.id, ...structuredClone(requestBody) };
    return { data: structuredClone(reserva) };
  });
  calendar.events.patch.mockImplementation(async ({ requestBody }) => {
    reserva = {
      ...reserva,
      ...structuredClone(requestBody),
      extendedProperties: {
        ...reserva.extendedProperties,
        ...requestBody.extendedProperties,
        private: {
          ...reserva.extendedProperties?.private,
          ...requestBody.extendedProperties?.private,
        },
      },
    };
    return { data: structuredClone(reserva) };
  });
  return { calendar, leerReserva: () => structuredClone(reserva) };
}

describe('reservas de Google al completar tutor y mascota', () => {
  const reservaOriginal = {
    id: 'reserva-del-tutor',
    status: 'confirmed',
    summary: 'Citas Estetica Omega',
    attendees: [{ email: 'tutor@example.test', responseStatus: 'accepted' }],
    organizer: { email: 'clinica@example.test' },
    location: 'Estética Omega',
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] },
    attachments: [{ fileUrl: 'https://example.test/indicaciones.pdf' }],
    conferenceData: { conferenceId: 'conferencia-existente' },
    extendedProperties: {
      private: { reservaOriginal: 'identificador-de-reserva' },
      shared: { origen: 'pagina-de-reservas' },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    isGoogleSyncConfigured.mockReturnValue(true);
  });

  it('al actualizar o reagendar conserva al tutor y los datos ajenos a Omega en el mismo evento', async () => {
    const { calendar, leerReserva } = fakeCalendarConReserva(reservaOriginal);
    getCalendarClient.mockReturnValue(calendar);
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      google_event_id: reservaOriginal.id,
    });

    await pushCita(1);

    expect(leerReserva()).toEqual({
      ...reservaOriginal,
      summary: 'Nissa — LoAng, Jimmy',
      description: CITA_NUEVA.motivo,
      start: { dateTime: CITA_NUEVA.fecha_hora_inicio },
      end: { dateTime: '2026-09-01T15:30:00.000Z' },
      colorId: '7',
      extendedProperties: {
        ...reservaOriginal.extendedProperties,
        private: { ...reservaOriginal.extendedProperties.private, citaId: '1' },
      },
    });
    expect(calendar.events.update).not.toHaveBeenCalled();
    expect(calendar.events.delete).not.toHaveBeenCalled();
    expect(calendar.events.insert).not.toHaveBeenCalled();
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(1, reservaOriginal.id);
  });

  it('una pendiente sin tutor vinculado conserva la invitacion al asignar mascota y confirmar desde Recepcion', async () => {
    const fechaFutura = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const cita = {
      ...CITA_NUEVA,
      fecha_hora_inicio: fechaFutura,
      estado: 'registrada',
      propietario_id: null,
      mascota_id: null,
      google_event_id: reservaOriginal.id,
    };
    const { calendar, leerReserva } = fakeCalendarConReserva(reservaOriginal);
    getCalendarClient.mockReturnValue(calendar);
    repository.findByIdParaSync.mockImplementation(async () =>
      cita.mascota_id === null ? undefined : { ...cita },
    );
    repository.findById.mockImplementation(async () => ({ ...cita }));
    doctoresRepository.findActivosByAreaId.mockResolvedValue([{ id: 10 }]);
    repository.existeTraslape.mockResolvedValue(false);
    repository.update.mockImplementation(async (_id, datos) => {
      cita.mascota_id = datos.mascotaId;
    });
    repository.confirmar.mockImplementation(async () => {
      cita.estado = 'confirmada';
    });

    await pushCita(cita.id);
    expect(calendar.events.patch).not.toHaveBeenCalled();
    expect(calendar.events.update).not.toHaveBeenCalled();

    await agendaService.editar({
      id: cita.id,
      areaId: 2,
      doctorId: 10,
      mascotaId: 20,
      fechaHoraInicio: fechaFutura,
      duracionMinutos: 30,
      motivo: cita.motivo,
      usuarioId: 42,
    });
    await agendaService.confirmar(cita.id, 42);
    // editar dispara el push en segundo plano; esperamos a que termine.
    await new Promise((resolve) => setImmediate(resolve));

    expect(cita.estado).toBe('confirmada');
    expect(leerReserva().id).toBe(reservaOriginal.id);
    expect(leerReserva().attendees).toEqual(reservaOriginal.attendees);
    expect(leerReserva().status).toBe('confirmed');
    expect(leerReserva().start.dateTime).toBe(fechaFutura);
    expect(calendar.events.update).not.toHaveBeenCalled();
    expect(calendar.events.delete).not.toHaveBeenCalled();
    expect(calendar.events.insert).not.toHaveBeenCalled();
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(cita.id, reservaOriginal.id);
  });
});

describe('agenda.googleSync.pushCita', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isGoogleSyncConfigured.mockReturnValue(true);
  });

  it('sin configurar, no toca el repository ni el cliente de Google', async () => {
    isGoogleSyncConfigured.mockReturnValue(false);
    await pushCita(1);
    expect(repository.findByIdParaSync).not.toHaveBeenCalled();
    expect(getCalendarClient).not.toHaveBeenCalled();
  });

  it('una cita sin google_event_id crea el evento (insert) y guarda el id devuelto', async () => {
    repository.findByIdParaSync.mockResolvedValue(CITA_NUEVA);
    const calendar = fakeCalendar();
    getCalendarClient.mockReturnValue(calendar);

    await pushCita(1);

    expect(calendar.events.insert).toHaveBeenCalledWith({
      calendarId: 'test-calendar-id',
      requestBody: expect.objectContaining({
        summary: 'Nissa — LoAng, Jimmy',
        colorId: '7',
        extendedProperties: { private: { citaId: '1' } },
      }),
    });
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(1, 'google-evt-1');
  });

  it('una cita con google_event_id existente actualiza el evento parcialmente (patch)', async () => {
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      google_event_id: 'evt-existente',
    });
    const calendar = fakeCalendar();
    getCalendarClient.mockReturnValue(calendar);

    await pushCita(1);

    expect(calendar.events.patch).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'test-calendar-id', eventId: 'evt-existente' }),
    );
    expect(calendar.events.insert).not.toHaveBeenCalled();
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(1, 'evt-existente');
  });

  // Bug real reportado 2026-09-22: una reserva externa importada desde OTRO
  // calendario guarda el id del evento de ESE calendario — al intentar
  // actualizarlo en el calendario principal, Google responde 404 (no existe
  // ahí). En vez de quedarse fallando por siempre, se crea el evento propio
  // en el calendario correcto, autocurándose.
  it('si el google_event_id guardado no existe en el calendario principal (404), crea uno nuevo ahí en vez de quedarse fallando', async () => {
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      google_event_id: 'evt-de-otro-calendario',
    });
    const calendar = fakeCalendar();
    calendar.events.patch.mockRejectedValue({ code: 404 });
    getCalendarClient.mockReturnValue(calendar);

    await pushCita(1);

    expect(calendar.events.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'test-calendar-id',
        eventId: 'evt-de-otro-calendario',
      }),
    );
    expect(calendar.events.insert).toHaveBeenCalledWith({
      calendarId: 'test-calendar-id',
      requestBody: expect.objectContaining({ summary: 'Nissa — LoAng, Jimmy' }),
    });
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(1, 'google-evt-1');
  });

  it('un error real (no 404/410) al actualizar SÍ se propaga como fallo (no crea uno nuevo por accidente)', async () => {
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      google_event_id: 'evt-existente',
    });
    const calendar = fakeCalendar();
    calendar.events.patch.mockRejectedValue(new Error('network down'));
    getCalendarClient.mockReturnValue(calendar);

    await expect(pushCita(1)).resolves.toBeUndefined();

    expect(calendar.events.insert).not.toHaveBeenCalled();
    expect(repository.marcarSincronizado).not.toHaveBeenCalled();
  });

  it('una cita cancelada con google_event_id borra el evento (delete)', async () => {
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      estado: 'cancelada',
      google_event_id: 'evt-a-borrar',
    });
    const calendar = fakeCalendar();
    getCalendarClient.mockReturnValue(calendar);

    await pushCita(1);

    expect(calendar.events.delete).toHaveBeenCalledWith({
      calendarId: 'test-calendar-id',
      eventId: 'evt-a-borrar',
    });
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(1, 'evt-a-borrar');
  });

  it('una cita cancelada sin google_event_id no intenta borrar nada', async () => {
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      estado: 'cancelada',
      google_event_id: null,
    });
    const calendar = fakeCalendar();
    getCalendarClient.mockReturnValue(calendar);

    await pushCita(1);

    expect(calendar.events.delete).not.toHaveBeenCalled();
  });

  it('si el evento ya no existe en Google (404/410) al cancelar, no truena', async () => {
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      estado: 'cancelada',
      google_event_id: 'evt-ya-borrado',
    });
    const calendar = fakeCalendar();
    calendar.events.delete.mockRejectedValue({ code: 410 });
    getCalendarClient.mockReturnValue(calendar);

    await expect(pushCita(1)).resolves.toBeUndefined();
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(1, 'evt-ya-borrado');
  });

  it('un error real de la API de Google se atrapa, no se propaga (se reintenta en el siguiente ciclo)', async () => {
    repository.findByIdParaSync.mockResolvedValue(CITA_NUEVA);
    const calendar = fakeCalendar();
    calendar.events.insert.mockRejectedValue(new Error('network down'));
    getCalendarClient.mockReturnValue(calendar);

    await expect(pushCita(1)).resolves.toBeUndefined();
    expect(repository.marcarSincronizado).not.toHaveBeenCalled();
  });

  it('un id de cita inexistente no truena', async () => {
    repository.findByIdParaSync.mockResolvedValue(undefined);
    await expect(pushCita(999)).resolves.toBeUndefined();
    expect(getCalendarClient).not.toHaveBeenCalled();
  });
});

describe('agenda.googleSync.sincronizar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isGoogleSyncConfigured.mockReturnValue(true);
    repository.findPendientesDePush.mockResolvedValue([]);
    repository.findSincronizadasFuturas.mockResolvedValue([]);
    importarReserva.mockResolvedValue(null);
  });

  it('sin configurar, no toca nada', async () => {
    isGoogleSyncConfigured.mockReturnValue(false);
    await sincronizar();
    expect(repository.findPendientesDePush).not.toHaveBeenCalled();
    expect(getCalendarClient).not.toHaveBeenCalled();
  });

  it('empuja cada cita pendiente (push) antes de revisar el pull', async () => {
    repository.findPendientesDePush.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    repository.findByIdParaSync.mockResolvedValue(CITA_NUEVA);
    const calendar = fakeCalendar();
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    expect(repository.findByIdParaSync).toHaveBeenCalledWith(1);
    expect(repository.findByIdParaSync).toHaveBeenCalledWith(2);
  });

  const CITA_SINCRONIZADA = {
    id: 5,
    google_event_id: 'evt-5',
    fecha_hora_inicio: new Date('2026-09-01T15:00:00.000Z'),
    duracion_minutos: 30,
    actualizado_en: null,
    google_sincronizado_en: new Date('2026-08-25T00:00:00.000Z'),
  };

  it('si la cita ya no aparece en Google, la cancela de este lado', async () => {
    repository.findSincronizadasFuturas.mockResolvedValue([CITA_SINCRONIZADA]);
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({ data: { items: [] } });
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    expect(repository.aplicarCancelacionDesdeGoogle).toHaveBeenCalledWith(5);
  });

  it('si el evento en Google está status:cancelled, la cancela de este lado', async () => {
    repository.findSincronizadasFuturas.mockResolvedValue([CITA_SINCRONIZADA]);
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({
      data: {
        items: [
          {
            status: 'cancelled',
            extendedProperties: { private: { citaId: '5' } },
          },
        ],
      },
    });
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    expect(repository.aplicarCancelacionDesdeGoogle).toHaveBeenCalledWith(5);
  });

  it('un evento en la SEGUNDA página de Google no se trata como cancelado (bug real 2026-09-22)', async () => {
    repository.findSincronizadasFuturas.mockResolvedValue([CITA_SINCRONIZADA]);
    const calendar = fakeCalendar();
    calendar.events.list
      .mockResolvedValueOnce({
        data: {
          items: [{ status: 'confirmed', extendedProperties: { private: { citaId: '999' } } }],
          nextPageToken: 'pagina-2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              status: 'confirmed',
              extendedProperties: { private: { citaId: '5' } },
              start: { dateTime: '2026-09-01T15:00:00.000Z' },
              end: { dateTime: '2026-09-01T15:30:00.000Z' },
            },
          ],
        },
      });
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    expect(calendar.events.list).toHaveBeenCalledTimes(2);
    expect(calendar.events.list.mock.calls[1][0]).toMatchObject({ pageToken: 'pagina-2' });
    expect(repository.aplicarCancelacionDesdeGoogle).not.toHaveBeenCalled();
  });

  it('si el horario del evento en Google cambió, reagenda de este lado', async () => {
    repository.findSincronizadasFuturas.mockResolvedValue([CITA_SINCRONIZADA]);
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({
      data: {
        items: [
          {
            status: 'confirmed',
            extendedProperties: { private: { citaId: '5' } },
            start: { dateTime: '2026-09-01T16:00:00.000Z' },
            end: { dateTime: '2026-09-01T16:45:00.000Z' },
          },
        ],
      },
    });
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    expect(repository.aplicarReagendoDesdeGoogle).toHaveBeenCalledWith(5, {
      fechaHoraInicio: new Date('2026-09-01T16:00:00.000Z'),
      duracionMinutos: 45,
    });
  });

  it('si el horario en Google coincide con el sistema, no hace nada', async () => {
    repository.findSincronizadasFuturas.mockResolvedValue([CITA_SINCRONIZADA]);
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({
      data: {
        items: [
          {
            status: 'confirmed',
            extendedProperties: { private: { citaId: '5' } },
            start: { dateTime: '2026-09-01T15:00:00.000Z' },
            end: { dateTime: '2026-09-01T15:30:00.000Z' },
          },
        ],
      },
    });
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    expect(repository.aplicarReagendoDesdeGoogle).not.toHaveBeenCalled();
    expect(repository.aplicarCancelacionDesdeGoogle).not.toHaveBeenCalled();
  });

  it('si hay una edición local sin sincronizar todavía, no la toca (gana lo local)', async () => {
    repository.findSincronizadasFuturas.mockResolvedValue([
      {
        ...CITA_SINCRONIZADA,
        actualizado_en: new Date('2026-08-25T12:00:00.000Z'),
        google_sincronizado_en: new Date('2026-08-25T00:00:00.000Z'),
      },
    ]);
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({ data: { items: [] } });
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    expect(repository.aplicarCancelacionDesdeGoogle).not.toHaveBeenCalled();
    expect(repository.aplicarReagendoDesdeGoogle).not.toHaveBeenCalled();
  });

  it('un evento de Google sin extendedProperties.private.citaId se ignora (no lo creamos nosotros)', async () => {
    repository.findSincronizadasFuturas.mockResolvedValue([CITA_SINCRONIZADA]);
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({
      data: { items: [{ status: 'confirmed', summary: 'Evento ajeno' }] },
    });
    getCalendarClient.mockReturnValue(calendar);

    await sincronizar();

    // Sin match por citaId, la cita 5 se trata como "ya no está" -> se cancela.
    expect(repository.aplicarCancelacionDesdeGoogle).toHaveBeenCalledWith(5);
  });

  it('si Google Calendar no responde en el pull, no truena (se loguea y sigue)', async () => {
    const calendar = fakeCalendar();
    calendar.events.list.mockRejectedValue(new Error('network down'));
    getCalendarClient.mockReturnValue(calendar);

    await expect(sincronizar()).resolves.toBeUndefined();
  });

  it('un evento sin citaId que SÍ es una reserva reconocida se importa y se empuja a Google', async () => {
    const eventoReserva = { id: 'evt-reserva-1', description: 'Nombre de la Mascota\nSparky' };
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({ data: { items: [eventoReserva] } });
    getCalendarClient.mockReturnValue(calendar);
    importarReserva.mockResolvedValue(42);
    repository.findByIdParaSync.mockResolvedValue(CITA_NUEVA);

    await sincronizar();

    expect(importarReserva).toHaveBeenCalledWith(eventoReserva);
    expect(repository.findByIdParaSync).toHaveBeenCalledWith(42); // pushCita(42)
  });

  it('bug real: una cita importada Y empujada en ESTE mismo ciclo no se cancela sola, aunque ya califique para la reconciliación', async () => {
    // El snapshot de events.list() se toma ANTES de que exista la cita
    // recién importada — eventosPorCitaId.get(42) siempre da undefined
    // en este mismo ciclo, sin importar que pushCita() SÍ haya etiquetado
    // el evento de Google con citaId=42 en el momento (ver el comentario
    // del fix en agenda.googleSync.js).
    const eventoReserva = { id: 'evt-reserva-1', description: 'Nombre de la Mascota\nSparky' };
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({ data: { items: [eventoReserva] } });
    getCalendarClient.mockReturnValue(calendar);
    importarReserva.mockResolvedValue(42);
    repository.findByIdParaSync.mockResolvedValue(CITA_NUEVA);
    // findSincronizadasFuturas es una consulta FRESCA que corre después
    // del import — ya incluye la cita 42 (mascota_id/google_event_id ya
    // están puestos para cuando esto se ejecuta).
    repository.findSincronizadasFuturas.mockResolvedValue([
      {
        id: 42,
        google_event_id: 'evt-reserva-1',
        fecha_hora_inicio: new Date('2026-09-01T15:00:00.000Z'),
        duracion_minutos: 30,
        actualizado_en: null,
        google_sincronizado_en: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);

    await sincronizar();

    expect(repository.aplicarCancelacionDesdeGoogle).not.toHaveBeenCalledWith(42);
  });

  it('un evento sin citaId que NO se reconoce como reserva (importarReserva regresa null) no dispara ningún push', async () => {
    const eventoAjeno = { id: 'evt-ajeno', description: 'Otro tipo de evento cualquiera' };
    const calendar = fakeCalendar();
    calendar.events.list.mockResolvedValue({ data: { items: [eventoAjeno] } });
    getCalendarClient.mockReturnValue(calendar);
    importarReserva.mockResolvedValue(null);

    await sincronizar();

    expect(importarReserva).toHaveBeenCalledWith(eventoAjeno);
    expect(repository.findByIdParaSync).not.toHaveBeenCalled();
  });

  // Pedido explícito del usuario, 2026-09-22: una página de reservas de
  // Google puede aterrizar en CUALQUIER calendario que el token de la
  // clínica también pueda ver (ej. el calendario personal de quien la creó)
  // — no solo el principal. Se revisan también esos otros calendarios.
  describe('reservas en calendarios adicionales', () => {
    it('una reserva encontrada en OTRO calendario visible se importa y se empuja igual que una del principal', async () => {
      const eventoOtroCalendario = {
        id: 'evt-otro-cal-1',
        description: 'Nombre de la Mascota\nNissa',
      };
      const calendar = fakeCalendar();
      calendar.calendarList.list.mockResolvedValue({
        data: { items: [{ id: 'test-calendar-id' }, { id: 'otro@gmail.com' }] },
      });
      calendar.events.list.mockImplementation(({ calendarId }) =>
        calendarId === 'otro@gmail.com'
          ? Promise.resolve({ data: { items: [eventoOtroCalendario] } })
          : Promise.resolve({ data: { items: [] } }),
      );
      getCalendarClient.mockReturnValue(calendar);
      importarReserva.mockResolvedValue(77);
      repository.findByIdParaSync.mockResolvedValue(CITA_NUEVA);

      await sincronizar();

      expect(importarReserva).toHaveBeenCalledWith(eventoOtroCalendario);
      expect(repository.findByIdParaSync).toHaveBeenCalledWith(77); // pushCita(77)
    });

    it('el calendario principal nunca se vuelve a revisar como "adicional" (no se duplica)', async () => {
      const calendar = fakeCalendar();
      calendar.calendarList.list.mockResolvedValue({
        data: { items: [{ id: 'test-calendar-id' }] },
      });
      getCalendarClient.mockReturnValue(calendar);

      await sincronizar();

      // Solo la llamada del calendario principal (dentro de sincronizar) —
      // ninguna adicional, porque el único id de la lista ES el principal.
      expect(calendar.events.list).toHaveBeenCalledTimes(1);
    });

    it('un evento CON citaId en un calendario adicional se ignora (no es una reserva externa, es propio)', async () => {
      const eventoPropio = {
        id: 'evt-propio-en-otro-cal',
        extendedProperties: { private: { citaId: '5' } },
      };
      const calendar = fakeCalendar();
      calendar.calendarList.list.mockResolvedValue({
        data: { items: [{ id: 'otro@gmail.com' }] },
      });
      calendar.events.list.mockImplementation(({ calendarId }) =>
        calendarId === 'otro@gmail.com'
          ? Promise.resolve({ data: { items: [eventoPropio] } })
          : Promise.resolve({ data: { items: [] } }),
      );
      getCalendarClient.mockReturnValue(calendar);

      await sincronizar();

      expect(importarReserva).not.toHaveBeenCalled();
    });

    it('si calendarList.list() falla, no truena todo el ciclo (se loguea y sigue)', async () => {
      const calendar = fakeCalendar();
      calendar.calendarList.list.mockRejectedValue(new Error('sin permiso'));
      getCalendarClient.mockReturnValue(calendar);

      await expect(sincronizar()).resolves.toBeUndefined();
    });
  });
});
