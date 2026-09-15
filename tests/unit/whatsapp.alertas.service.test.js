jest.mock('../../src/config/database');
jest.mock('../../src/modules/whatsapp/whatsapp.alertas.repository');
jest.mock('../../src/modules/whatsapp/whatsapp.outbox');
jest.mock('../../src/modules/whatsapp/whatsapp.alertas.eventos');

const db = require('../../src/config/database');
const repository = require('../../src/modules/whatsapp/whatsapp.alertas.repository');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');
const eventos = require('../../src/modules/whatsapp/whatsapp.alertas.eventos');
const {
  registrarSolicitudAlerta,
  solicitarAlerta,
  procesarSiguienteAlertaPendiente,
  normalizarTelefonoPersonal,
  payloadWhatsapp,
  AlertaValidationError,
} = require('../../src/modules/whatsapp/whatsapp.alertas.service');

beforeEach(() => {
  jest.clearAllMocks();
  db.transaction = jest.fn((callback) => callback('trx-fake'));
});

describe('whatsapp.alertas.service — reglas deterministas WA018', () => {
  it.each([
    ['771-163-4578', '527711634578'],
    ['527711634578', '527711634578'],
    ['5217711634578', '527711634578'],
    ['', null],
    ['123', null],
  ])('normaliza %p a %p', (entrada, esperada) => {
    expect(normalizarTelefonoPersonal(entrada)).toBe(esperada);
  });

  it.each([
    ['emergencia', 'alerta_emergencia_personal_v1'],
    ['recepcion', 'alerta_recepcion_personal_v1'],
  ])('construye una plantilla Meta separada para %s', (tipo, nombre) => {
    const payload = payloadWhatsapp(tipo, '525500001111');
    expect(payload.tipo).toBe('template');
    expect(payload.plantilla).toMatchObject({ name: nombre, language: { code: 'es_MX' } });
    expect(JSON.stringify(payload)).not.toMatch(/diagn[oó]stico|s[ií]ntoma/i);
  });

  it('WA019 persiste primero sin consultar usuarios ni preparar canales', async () => {
    repository.crearAlerta.mockResolvedValue({
      alerta: { id: 9, tipo_alerta: 'recepcion', resolucion_destinatarios: 'pendiente' },
      esNueva: true,
    });

    await registrarSolicitudAlerta({
      claveIdempotencia: 'alerta-menu-recepcion-1',
      tipoAlerta: 'recepcion',
      conversacionId: 5,
      grupoId: 7,
      mensajeOrigenId: 8,
      whatsappMessageIdOrigen: 'wamid.menu-recepcion-1',
      telefonoExterno: '525500001111',
      origen: 'menu_recepcion',
      solicitadaEn: new Date('2026-09-15T12:00:00Z'),
      trx: 'trx-fake',
    });

    expect(repository.crearAlerta).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAlerta: 'recepcion',
        conversacionId: 5,
        grupoId: 7,
        mensajeOrigenId: 8,
        whatsappMessageIdOrigen: 'wamid.menu-recepcion-1',
        telefonoExterno: '525500001111',
        origen: 'menu_recepcion',
        solicitadaEn: new Date('2026-09-15T12:00:00Z'),
      }),
      'trx-fake',
    );
    expect(repository.resolverUsuarios).not.toHaveBeenCalled();
    expect(repository.registrarIntentoCanal).not.toHaveBeenCalled();
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
  });

  it('el worker WA018 retoma una solicitud pendiente y publica después del commit', async () => {
    repository.buscarSiguientePendienteResolucion.mockResolvedValue({
      id: 13,
      tipo_alerta: 'recepcion',
      telefono_externo: '525500001111',
    });
    repository.resolverUsuarios.mockResolvedValue([]);
    repository.guardarDestinatarios.mockResolvedValue([]);

    const resultado = await procesarSiguienteAlertaPendiente();

    expect(repository.buscarSiguientePendienteResolucion).toHaveBeenCalledWith('trx-fake');
    expect(repository.resolverUsuarios).toHaveBeenNthCalledWith(1, 'recepcion', 'trx-fake');
    expect(repository.resolverUsuarios).toHaveBeenNthCalledWith(2, 'admin', 'trx-fake');
    expect(repository.guardarResolucion).toHaveBeenCalledWith(13, 'sin_destinatarios', 'trx-fake');
    expect(eventos.publicarActualizacion).toHaveBeenCalledTimes(1);
    expect(resultado.alerta.resolucion_destinatarios).toBe('sin_destinatarios');
  });

  it('crea la alerta antes de consultar destinatarios y usa doctor para emergencia', async () => {
    repository.crearAlerta.mockResolvedValue({
      alerta: { id: 10, tipo_alerta: 'emergencia', telefono_externo: '525500001111' },
      esNueva: true,
    });
    repository.resolverUsuarios.mockResolvedValue([{ id: 2, tipo_usuario: 'doctor' }]);
    repository.guardarDestinatarios.mockResolvedValue([]);

    await solicitarAlerta({
      claveIdempotencia: 'alerta-1',
      tipoAlerta: 'emergencia',
      conversacionId: 5,
      telefonoExterno: '525500001111',
      origen: 'emergencia',
      trx: 'trx-fake',
    });

    expect(repository.crearAlerta.mock.invocationCallOrder[0]).toBeLessThan(
      repository.resolverUsuarios.mock.invocationCallOrder[0],
    );
    expect(repository.resolverUsuarios).toHaveBeenCalledWith('doctor', 'trx-fake');
    expect(repository.resolverUsuarios).not.toHaveBeenCalledWith('admin', expect.anything());
    expect(repository.guardarResolucion).toHaveBeenCalledWith(10, 'principal', 'trx-fake');
  });

  it('usa admin solamente cuando no existe el tipo principal', async () => {
    repository.crearAlerta.mockResolvedValue({
      alerta: { id: 11, tipo_alerta: 'recepcion' },
      esNueva: true,
    });
    repository.resolverUsuarios
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 3, tipo_usuario: 'admin' }]);
    repository.guardarDestinatarios.mockResolvedValue([]);

    await solicitarAlerta({
      claveIdempotencia: 'alerta-2',
      tipoAlerta: 'recepcion',
      conversacionId: 5,
      origen: 'recepcion',
      trx: 'trx-fake',
    });

    expect(repository.resolverUsuarios).toHaveBeenNthCalledWith(1, 'recepcion', 'trx-fake');
    expect(repository.resolverUsuarios).toHaveBeenNthCalledWith(2, 'admin', 'trx-fake');
    expect(repository.guardarResolucion).toHaveBeenCalledWith(11, 'respaldo_admin', 'trx-fake');
  });

  it('una clave ya existente no recalcula ni registra canales', async () => {
    repository.crearAlerta.mockResolvedValue({ alerta: { id: 12 }, esNueva: false });

    const resultado = await solicitarAlerta({
      claveIdempotencia: 'alerta-3',
      tipoAlerta: 'emergencia',
      conversacionId: 5,
      origen: 'emergencia',
      trx: 'trx-fake',
    });

    expect(resultado.esNueva).toBe(false);
    expect(repository.resolverUsuarios).not.toHaveBeenCalled();
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
  });

  it('rechaza tipos libres sin consultar usuarios ni Claude', async () => {
    await expect(
      solicitarAlerta({
        claveIdempotencia: 'alerta-4',
        tipoAlerta: 'otro',
        conversacionId: 5,
        origen: 'otro',
      }),
    ).rejects.toThrow(AlertaValidationError);
    expect(repository.crearAlerta).not.toHaveBeenCalled();
    expect(eventos.publicarActualizacion).not.toHaveBeenCalled();
  });
});
