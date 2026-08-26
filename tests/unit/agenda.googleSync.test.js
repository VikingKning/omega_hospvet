// Sincronización con Google Calendar — el cliente real de Google y el
// repository se mockean por completo, nunca se pega a la red real (mismo
// criterio que el resto de los tests unitarios del proyecto).
jest.mock('../../src/modules/agenda/agenda.repository');
jest.mock('../../src/config/googleCalendar');
jest.mock('../../src/config/env', () => ({
  ...jest.requireActual('../../src/config/env'),
  google: { calendarId: 'test-calendar-id', syncIntervalMinutes: 10 },
}));

const repository = require('../../src/modules/agenda/agenda.repository');
const { getCalendarClient, isGoogleSyncConfigured } = require('../../src/config/googleCalendar');
const { pushCita, sincronizar } = require('../../src/modules/agenda/agenda.googleSync');

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
      delete: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue({ data: { items: [] } }),
    },
  };
}

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

  it('una cita con google_event_id existente actualiza el evento (update)', async () => {
    repository.findByIdParaSync.mockResolvedValue({
      ...CITA_NUEVA,
      google_event_id: 'evt-existente',
    });
    const calendar = fakeCalendar();
    getCalendarClient.mockReturnValue(calendar);

    await pushCita(1);

    expect(calendar.events.update).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'test-calendar-id', eventId: 'evt-existente' }),
    );
    expect(calendar.events.insert).not.toHaveBeenCalled();
    expect(repository.marcarSincronizado).toHaveBeenCalledWith(1, 'evt-existente');
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
});
