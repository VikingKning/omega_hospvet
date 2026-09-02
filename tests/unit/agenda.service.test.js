jest.mock('../../src/modules/agenda/agenda.repository');
jest.mock('../../src/modules/areas/areas.repository');
jest.mock('../../src/modules/doctores/doctores.repository');
jest.mock('../../src/modules/agenda/agenda.googleSync');
const repository = require('../../src/modules/agenda/agenda.repository');
const areasRepository = require('../../src/modules/areas/areas.repository');
const doctoresRepository = require('../../src/modules/doctores/doctores.repository');
const googleSync = require('../../src/modules/agenda/agenda.googleSync');
const {
  resolverArea,
  resumenDelDia,
  listarEventos,
  listarOcupado,
  crear,
  editar,
  cancelar,
  obtener,
  CitaValidationError,
  TraslapeError,
  DoctorFueraDeAreaError,
} = require('../../src/modules/agenda/agenda.service');

const DOCTOR_EN_AREA = { id: 5, nombre: 'Ana', apellidos: 'Pérez' };

// Fecha de prueba SIEMPRE en el futuro (mañana a las 15:00 UTC) — nunca una
// fecha fija: agenda.service.js#validateFechaHoraInicio rechaza cualquier
// fecha en el pasado, así que un literal tipo '2026-09-01T15:00:00.000Z'
// empieza a fallar solo en cuanto el calendario real lo alcanza (bug real
// encontrado en vivo: el propio suite se rompió el día que rodó la fecha).
function mananaALas15UTC() {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + 1);
  fecha.setUTCHours(15, 0, 0, 0);
  return fecha;
}
const FECHA_FUTURA = mananaALas15UTC();
const FECHA_FUTURA_ISO = FECHA_FUTURA.toISOString();
const FECHA_FUTURA_MAS_30MIN = new Date(FECHA_FUTURA.getTime() + 30 * 60000);

// jest.clearAllMocks() (en cada describe de abajo) limpia las llamadas
// registradas pero NO el mockResolvedValue de aquí — se define una sola
// vez porque dispararSyncGoogle() en agenda.service.js hace
// `googleSync.pushCita(id).catch(...)`: sin un valor resuelto, el mock
// automático de Jest regresa `undefined` y `.catch()` truena.
googleSync.pushCita.mockResolvedValue(undefined);

describe('agenda.service.resolverArea', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve el área si existe y está activa', async () => {
    areasRepository.findBySlug.mockResolvedValue({ id: 1, slug: 'cirugias', activo: true });
    const area = await resolverArea('cirugias');
    expect(area).toEqual({ id: 1, slug: 'cirugias', activo: true });
  });

  it('devuelve undefined si el área no existe', async () => {
    areasRepository.findBySlug.mockResolvedValue(undefined);
    expect(await resolverArea('no-existe')).toBeUndefined();
  });

  it('devuelve undefined si el área existe pero está inactiva', async () => {
    areasRepository.findBySlug.mockResolvedValue({ id: 1, slug: 'cirugias', activo: false });
    expect(await resolverArea('cirugias')).toBeUndefined();
  });
});

describe('agenda.service.resumenDelDia', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clasifica pasadas/pendientes por hora, y trae la siguiente cita futura', async () => {
    const ahora = new Date();
    const haceUnaHora = new Date(ahora.getTime() - 60 * 60000);
    const enUnaHora = new Date(ahora.getTime() + 60 * 60000);

    repository.findEnRango.mockResolvedValue([
      { id: 1, fecha_hora_inicio: haceUnaHora.toISOString() },
      { id: 2, fecha_hora_inicio: enUnaHora.toISOString() },
    ]);
    repository.findSiguiente.mockResolvedValue({
      id: 2,
      fecha_hora_inicio: enUnaHora.toISOString(),
    });

    const resumen = await resumenDelDia(9);

    expect(resumen.pasadas).toHaveLength(1);
    expect(resumen.pasadas[0].id).toBe(1);
    expect(resumen.pendientes).toHaveLength(1);
    expect(resumen.pendientes[0].id).toBe(2);
    expect(resumen.siguiente.id).toBe(2);
  });

  it('las citas ya excluidas por el repository (canceladas) nunca llegan aquí, pero si "siguiente" es null, no truena', async () => {
    repository.findEnRango.mockResolvedValue([]);
    repository.findSiguiente.mockResolvedValue(undefined);

    const resumen = await resumenDelDia(9);

    expect(resumen.pasadas).toEqual([]);
    expect(resumen.pendientes).toEqual([]);
    expect(resumen.siguiente).toBeNull();
  });
});

// Pedido explícito del usuario: filtrar el calendario por doctor, además
// de área+rango — el service solo parsea `doctorId` (id inválido/vacío no
// filtra, es un filtro de vista, no un dato que se vaya a guardar).
describe('agenda.service.listarEventos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin doctorId, no manda filtro de doctor al repository', async () => {
    repository.findEnRango.mockResolvedValue([]);
    await listarEventos(9, { desde: '2026-08-24', hasta: '2026-08-31', doctorId: undefined });
    expect(repository.findEnRango).toHaveBeenCalledWith(
      9,
      new Date('2026-08-24'),
      new Date('2026-08-31'),
      undefined,
    );
  });

  it('con un doctorId válido, lo manda parseado (número) al repository', async () => {
    repository.findEnRango.mockResolvedValue([]);
    await listarEventos(9, { desde: '2026-08-24', hasta: '2026-08-31', doctorId: '67' });
    expect(repository.findEnRango).toHaveBeenCalledWith(
      9,
      new Date('2026-08-24'),
      new Date('2026-08-31'),
      67,
    );
  });

  it('con un doctorId inválido, no filtra en vez de tronar', async () => {
    repository.findEnRango.mockResolvedValue([]);
    await listarEventos(9, { desde: '2026-08-24', hasta: '2026-08-31', doctorId: 'no-es-un-id' });
    expect(repository.findEnRango).toHaveBeenCalledWith(
      9,
      new Date('2026-08-24'),
      new Date('2026-08-31'),
      undefined,
    );
  });
});

// Pedido explícito del usuario: al filtrar por doctor, marcar en gris (sin
// detalle) sus horas ya ocupadas en OTRAS áreas — un doctor puede atender
// varias, y una cita ahí lo bloquea igual (mismo criterio cross-área que ya
// usa existeTraslape).
describe('agenda.service.listarOcupado', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin doctorId, regresa vacío sin tocar el repository (nadie que preguntar)', async () => {
    const result = await listarOcupado(9, {
      desde: '2026-08-24',
      hasta: '2026-08-31',
      doctorId: undefined,
    });
    expect(result).toEqual([]);
    expect(repository.findOcupadoPorDoctor).not.toHaveBeenCalled();
  });

  it('con un doctorId inválido, regresa vacío sin tocar el repository', async () => {
    const result = await listarOcupado(9, {
      desde: '2026-08-24',
      hasta: '2026-08-31',
      doctorId: 'no-es-un-id',
    });
    expect(result).toEqual([]);
    expect(repository.findOcupadoPorDoctor).not.toHaveBeenCalled();
  });

  it('con un doctorId válido, consulta el repository excluyendo el área actual', async () => {
    const bloques = [
      { id: 1, fecha_hora_inicio: '2026-08-24T10:00:00.000Z', duracion_minutos: 30 },
    ];
    repository.findOcupadoPorDoctor.mockResolvedValue(bloques);
    const result = await listarOcupado(9, {
      desde: '2026-08-24',
      hasta: '2026-08-31',
      doctorId: '67',
    });
    expect(repository.findOcupadoPorDoctor).toHaveBeenCalledWith(
      67,
      new Date('2026-08-24'),
      new Date('2026-08-31'),
      9,
    );
    expect(result).toEqual(bloques);
  });
});

describe('agenda.service.crear', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    doctoresRepository.findActivosByAreaId.mockResolvedValue([DOCTOR_EN_AREA]);
    repository.existeTraslape.mockResolvedValue(false);
    repository.create.mockResolvedValue(99);
  });

  const datosValidos = {
    areaId: 1,
    doctorId: '5',
    mascotaId: '10',
    fechaHoraInicio: FECHA_FUTURA_ISO,
    duracionMinutos: '30',
    motivo: '  Revisión general  ',
    usuarioId: 2,
  };

  it('crea la cita con los datos parseados/recortados', async () => {
    const id = await crear(datosValidos);

    expect(repository.create).toHaveBeenCalledWith({
      areaId: 1,
      doctorId: 5,
      mascotaId: 10,
      fechaHoraInicio: FECHA_FUTURA,
      duracionMinutos: 30,
      motivo: 'Revisión general',
      usuarioId: 2,
    });
    expect(id).toBe(99);
  });

  it('un motivo vacío se guarda como null, no como cadena vacía', async () => {
    await crear({ ...datosValidos, motivo: '   ' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ motivo: null }));
  });

  it('rechaza sin doctor seleccionado', async () => {
    await expect(crear({ ...datosValidos, doctorId: '' })).rejects.toThrow(CitaValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza sin mascota seleccionada', async () => {
    await expect(crear({ ...datosValidos, mascotaId: '' })).rejects.toThrow(CitaValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza una fecha/hora inválida o ausente', async () => {
    await expect(crear({ ...datosValidos, fechaHoraInicio: '' })).rejects.toThrow(
      CitaValidationError,
    );
    await expect(crear({ ...datosValidos, fechaHoraInicio: 'no-es-una-fecha' })).rejects.toThrow(
      CitaValidationError,
    );
  });

  // Pedido explícito del usuario: no se pueden agendar citas del momento
  // actual hacia atrás.
  it('rechaza una fecha/hora en el pasado', async () => {
    const haceUnaHora = new Date(Date.now() - 60 * 60000).toISOString();
    await expect(crear({ ...datosValidos, fechaHoraInicio: haceUnaHora })).rejects.toThrow(
      CitaValidationError,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza una duración fuera de los presets válidos (whitelist real, no solo visual)', async () => {
    await expect(crear({ ...datosValidos, duracionMinutos: '37' })).rejects.toThrow(
      CitaValidationError,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza si el doctor no atiende esta área', async () => {
    doctoresRepository.findActivosByAreaId.mockResolvedValue([{ id: 999 }]);
    await expect(crear(datosValidos)).rejects.toThrow(DoctorFueraDeAreaError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza si hay traslape con otra cita del mismo doctor', async () => {
    repository.existeTraslape.mockResolvedValue(true);
    await expect(crear(datosValidos)).rejects.toThrow(TraslapeError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('el chequeo de traslape usa el fin calculado (inicio + duración), no excluye ninguna cita propia (alta)', async () => {
    await crear(datosValidos);
    expect(repository.existeTraslape).toHaveBeenCalledWith(
      5,
      FECHA_FUTURA,
      FECHA_FUTURA_MAS_30MIN,
      undefined,
    );
  });

  // Pedido explícito del usuario: push a Google Calendar tras crear, sin
  // bloquear la respuesta (dispararSyncGoogle no se espera).
  it('dispara el push a Google Calendar con el id recién creado', async () => {
    const id = await crear(datosValidos);
    expect(googleSync.pushCita).toHaveBeenCalledWith(id);
  });
});

describe('agenda.service.editar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    doctoresRepository.findActivosByAreaId.mockResolvedValue([DOCTOR_EN_AREA]);
    repository.existeTraslape.mockResolvedValue(false);
    repository.update.mockResolvedValue();
  });

  const datosValidos = {
    id: 42,
    areaId: 1,
    doctorId: '5',
    mascotaId: '10',
    fechaHoraInicio: FECHA_FUTURA_ISO,
    duracionMinutos: '60',
    motivo: 'Seguimiento',
    usuarioId: 2,
  };

  it('actualiza la cita, nunca toca `estado`', async () => {
    await editar(datosValidos);

    expect(repository.update).toHaveBeenCalledWith(42, {
      doctorId: 5,
      mascotaId: 10,
      fechaHoraInicio: FECHA_FUTURA,
      duracionMinutos: 60,
      motivo: 'Seguimiento',
      usuarioId: 2,
    });
  });

  it('excluye la propia cita al chequear traslape', async () => {
    await editar(datosValidos);
    expect(repository.existeTraslape).toHaveBeenCalledWith(
      5,
      expect.any(Date),
      expect.any(Date),
      42,
    );
  });

  it('rechaza si hay traslape con OTRA cita', async () => {
    repository.existeTraslape.mockResolvedValue(true);
    await expect(editar(datosValidos)).rejects.toThrow(TraslapeError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rechaza si el nuevo doctor no atiende esta área', async () => {
    doctoresRepository.findActivosByAreaId.mockResolvedValue([]);
    await expect(editar(datosValidos)).rejects.toThrow(DoctorFueraDeAreaError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  // Pedido explícito del usuario: reagendar hacia un horario ya pasado
  // tampoco se permite (misma validación que crear()).
  it('rechaza reagendar hacia una fecha/hora en el pasado', async () => {
    const haceUnaHora = new Date(Date.now() - 60 * 60000).toISOString();
    await expect(editar({ ...datosValidos, fechaHoraInicio: haceUnaHora })).rejects.toThrow(
      CitaValidationError,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('dispara el push a Google Calendar tras editar', async () => {
    await editar(datosValidos);
    expect(googleSync.pushCita).toHaveBeenCalledWith(42);
  });
});

describe('agenda.service.cancelar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delega en el repository con el id ya parseado y el usuario que ejecuta la baja', async () => {
    await cancelar('7', 42);
    expect(repository.cancelar).toHaveBeenCalledWith(7, 42);
  });

  it('un id inválido no truena y no llega al repository', async () => {
    await cancelar('no-es-un-numero', 42);
    expect(repository.cancelar).not.toHaveBeenCalled();
  });

  it('dispara el push a Google Calendar tras cancelar', async () => {
    await cancelar('7', 42);
    expect(googleSync.pushCita).toHaveBeenCalledWith(7);
  });
});

describe('agenda.service.obtener', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delega en el repository con el id ya parseado', async () => {
    repository.findById.mockResolvedValue({ id: 7 });
    const result = await obtener('7');
    expect(repository.findById).toHaveBeenCalledWith(7);
    expect(result).toEqual({ id: 7 });
  });

  it('un id inválido no llega al repository, devuelve undefined', async () => {
    const result = await obtener('no-es-un-numero');
    expect(result).toBeUndefined();
    expect(repository.findById).not.toHaveBeenCalled();
  });
});
