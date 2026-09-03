// POST /agenda/:slug/citas/:id/confirmar — pedido explícito del usuario:
// completa (editar) Y confirma en un solo paso, sin exigir un Guardar
// aparte antes (ver cita-form.ejs). Solo se cubre `confirmar()` aquí: el
// resto del controller (crear/editar/cancelar/eventos) ya se prueba a
// nivel integración; esta acción compuesta es la única con lógica de
// orquestación (editar() -> confirmar()) que vale la pena aislar.
jest.mock('../../src/modules/agenda/agenda.service');
jest.mock('../../src/modules/tutores/tutores.service');
jest.mock('../../src/config/csrf');
const service = require('../../src/modules/agenda/agenda.service');
const tutoresService = require('../../src/modules/tutores/tutores.service');
const { generateCsrfToken } = require('../../src/config/csrf');
const controller = require('../../src/modules/agenda/agenda.controller');

function makeRes() {
  return { render: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn(), set: jest.fn() };
}

function makeReq(overrides = {}) {
  return {
    params: { id: '7' },
    area: { id: 22, slug: 'consultas' },
    body: {
      mascotaId: '10',
      doctorId: '87',
      fechaHoraInicio: '2026-09-10T15:00:00.000Z',
      duracionMinutos: '30',
    },
    session: { user: { id: 1 } },
    ...overrides,
  };
}

const CITA_EXISTENTE = { id: 7, area_id: 22, estado: 'registrada', mascota_id: null };

beforeEach(() => {
  jest.clearAllMocks();
  generateCsrfToken.mockReturnValue('csrf-fake');
  service.obtener.mockResolvedValue(CITA_EXISTENTE);
  service.editar.mockResolvedValue();
  service.confirmar.mockResolvedValue();
  service.listarDoctoresDelArea.mockResolvedValue([]);
  tutoresService.resolverMascota.mockResolvedValue(null);
});

describe('agenda.controller.confirmar', () => {
  it('caso exitoso: llama editar() ANTES que confirmar(), con los datos del body, y responde con el trigger de éxito', async () => {
    const orden = [];
    service.editar.mockImplementation(async () => orden.push('editar'));
    service.confirmar.mockImplementation(async () => orden.push('confirmar'));
    const req = makeReq();
    const res = makeRes();

    await controller.confirmar(req, res, jest.fn());

    expect(orden).toEqual(['editar', 'confirmar']);
    expect(service.editar).toHaveBeenCalledWith(
      expect.objectContaining({ id: '7', areaId: 22, mascotaId: '10', usuarioId: 1 }),
    );
    expect(service.confirmar).toHaveBeenCalledWith('7', 1);
    expect(res.set).toHaveBeenCalledWith('HX-Trigger', 'closeCitaModal');
    expect(res.render).not.toHaveBeenCalled();
  });

  it('una cita inexistente (o de otra área) responde 404, no llega a editar()', async () => {
    service.obtener.mockResolvedValue(undefined);
    const req = makeReq();
    const res = makeRes();

    await controller.confirmar(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(service.editar).not.toHaveBeenCalled();
  });

  it('una cita de otra área responde 404', async () => {
    service.obtener.mockResolvedValue({ ...CITA_EXISTENTE, area_id: 99 });
    const req = makeReq();
    const res = makeRes();

    await controller.confirmar(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('si editar() rechaza (ej. traslape), re-renderiza el formulario con el error y nunca llama a confirmar()', async () => {
    const error = new Error('El doctor ya tiene otra cita en ese horario.');
    error.status = 409;
    service.editar.mockRejectedValue(error);
    const req = makeReq();
    const res = makeRes();

    await controller.confirmar(req, res, jest.fn());

    expect(service.confirmar).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith(
      'partials/cita-form',
      expect.objectContaining({ error: error.message, cita: CITA_EXISTENTE }),
    );
  });

  it('si confirmar() rechaza DESPUÉS de que editar() ya funcionó, también re-renderiza el formulario con el error', async () => {
    const error = new Error('Completa la mascota antes de confirmar la cita.');
    error.status = 400;
    service.confirmar.mockRejectedValue(error);
    const req = makeReq();
    const res = makeRes();

    await controller.confirmar(req, res, jest.fn());

    expect(service.editar).toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith(
      'partials/cita-form',
      expect.objectContaining({ error: error.message }),
    );
  });

  it('un error inesperado (sin .status) se delega a next(), no se re-renderiza nada', async () => {
    service.editar.mockRejectedValue(new Error('algo inesperado'));
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await controller.confirmar(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.render).not.toHaveBeenCalled();
  });

  // Pedido explícito del usuario: separar tutor de mascota en el formulario
  // — el re-render por error debe traer el tutor precargado para que el
  // combobox de Mascota (filtrado por tutor, ver cita-form.ejs/agenda.ejs)
  // no se quede vacío.
  it('con una mascota ya elegida en el body, resuelve el tutor desde su propietario_id', async () => {
    const error = new Error('El doctor ya tiene otra cita en ese horario.');
    error.status = 409;
    service.editar.mockRejectedValue(error);
    tutoresService.resolverMascota.mockResolvedValue({
      id: 10,
      nombre: 'Firulais',
      propietario_id: 55,
    });
    const tutor = { id: 55, nombre: 'Ana', apellidos: 'Ruiz', pacientes: [] };
    tutoresService.resolverTutorPorId.mockResolvedValue(tutor);
    const req = makeReq();
    const res = makeRes();

    await controller.confirmar(req, res, jest.fn());

    expect(tutoresService.resolverTutorPorId).toHaveBeenCalledWith(55);
    expect(res.render).toHaveBeenCalledWith(
      'partials/cita-form',
      expect.objectContaining({ tutorSeleccionado: tutor }),
    );
  });

  it('sin mascota en el body (reserva externa pendiente), cae al propietario_id de la cita ya guardada', async () => {
    const error = new Error('Completa la mascota antes de confirmar la cita.');
    error.status = 400;
    service.confirmar.mockRejectedValue(error);
    service.obtener.mockResolvedValue({ ...CITA_EXISTENTE, propietario_id: 77 });
    tutoresService.resolverMascota.mockResolvedValue(null);
    const tutor = { id: 77, nombre: 'Beto', apellidos: 'Gómez', pacientes: [] };
    tutoresService.resolverTutorPorId.mockResolvedValue(tutor);
    const req = makeReq();
    const res = makeRes();

    await controller.confirmar(req, res, jest.fn());

    expect(tutoresService.resolverTutorPorId).toHaveBeenCalledWith(77);
    expect(res.render).toHaveBeenCalledWith(
      'partials/cita-form',
      expect.objectContaining({ tutorSeleccionado: tutor }),
    );
  });
});
