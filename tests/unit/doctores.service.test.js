jest.mock('../../src/modules/doctores/doctores.repository');
const repository = require('../../src/modules/doctores/doctores.repository');
const {
  list,
  desactivar,
  obtener,
  listAreasDisponibles,
  resolverAreas,
  crear,
  editar,
  DoctorValidationError,
} = require('../../src/modules/doctores/doctores.service');
const db = require('../../src/config/database');

afterAll(() => db.destroy());

describe('doctores.service.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    repository.findPage.mockResolvedValue([]);
  });

  it('AC2: por defecto filtra solo activos', async () => {
    await list({});
    expect(repository.findPage).toHaveBeenCalledWith(expect.objectContaining({ activoOnly: true }));
  });

  it('estado=todos desactiva el filtro de activos', async () => {
    await list({ estado: 'todos' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ activoOnly: false }),
    );
  });

  it('recorta espacios en la búsqueda y manda undefined si queda vacía', async () => {
    await list({ q: '   ' });
    expect(repository.findPage).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
  });

  it('una página inválida cae a la página 1, no truena', async () => {
    const result = await list({ page: 'no-es-un-numero' });
    expect(result.page).toBe(1);
  });

  it('una página fuera de rango se recorta al total de páginas', async () => {
    repository.count.mockResolvedValue(5); // 5 doctores, PAGE_SIZE=10 => 1 sola página
    const result = await list({ page: '99' });
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('catalogoVacio es true solo cuando no existe ningún doctor (sin importar filtros)', async () => {
    repository.existsAny.mockResolvedValue(false);
    const result = await list({});
    expect(result.catalogoVacio).toBe(true);
  });

  it('catalogoVacio es false si hay doctores aunque esta búsqueda no encuentre nada', async () => {
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    const result = await list({ q: 'no-coincide-con-nada' });
    expect(result.catalogoVacio).toBe(false);
    expect(result.total).toBe(0);
  });

  it('por defecto ordena por doctor ascendente', async () => {
    const result = await list({});
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'doctor', dir: 'asc' }),
    );
    expect(result.sort).toBe('doctor');
    expect(result.dir).toBe('asc');
  });

  it.each([['doctor'], ['areas'], ['estado']])('acepta ordenar por %s', async (column) => {
    await list({ sort: column, dir: 'desc' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ sort: column, dir: 'desc' }),
    );
  });

  it('una columna de orden desconocida cae a "doctor", no truena', async () => {
    const result = await list({ sort: 'algo-que-no-existe' });
    expect(result.sort).toBe('doctor');
  });

  it('una dirección desconocida cae a "asc"', async () => {
    const result = await list({ dir: 'algo-raro' });
    expect(result.dir).toBe('asc');
  });
});

describe('doctores.service.desactivar (US-608)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delega en el repository con el id ya parseado y el usuario que ejecuta la baja', async () => {
    await desactivar('7', 42);
    expect(repository.desactivar).toHaveBeenCalledWith(7, 42);
  });

  it('un id inválido no truena y no llega al repository', async () => {
    await desactivar('no-es-un-numero', 42);
    expect(repository.desactivar).not.toHaveBeenCalled();
  });
});

describe('doctores.service.obtener (US-607)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('incluye las áreas ya asignadas junto con los datos del doctor', async () => {
    repository.findById.mockResolvedValue({
      id: 7,
      nombre: 'Ana',
      apellidos: 'Gómez',
      activo: true,
    });
    repository.findAreasByDoctorId.mockResolvedValue([{ id: 1, nombre: 'Cardiología' }]);

    const result = await obtener('7');

    expect(repository.findAreasByDoctorId).toHaveBeenCalledWith(7);
    expect(result).toEqual({
      id: 7,
      nombre: 'Ana',
      apellidos: 'Gómez',
      activo: true,
      areas: [{ id: 1, nombre: 'Cardiología' }],
    });
  });

  it('un id inválido no llega al repository, devuelve undefined', async () => {
    const result = await obtener('no-es-un-numero');
    expect(result).toBeUndefined();
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('un doctor inexistente devuelve undefined sin pedir sus áreas', async () => {
    repository.findById.mockResolvedValue(undefined);
    const result = await obtener('7');
    expect(result).toBeUndefined();
    expect(repository.findAreasByDoctorId).not.toHaveBeenCalled();
  });
});

describe('doctores.service.listAreasDisponibles / resolverAreas (US-607)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('listAreasDisponibles delega en el repository', async () => {
    repository.listAreasActivas.mockResolvedValue([{ id: 1, nombre: 'Cardiología' }]);
    const result = await listAreasDisponibles();
    expect(result).toEqual([{ id: 1, nombre: 'Cardiología' }]);
  });

  it('resolverAreas normaliza los ids (string/array/duplicados/inválidos) antes de pedirlos', async () => {
    repository.findAreasByIds.mockResolvedValue([{ id: 1, nombre: 'Cardiología' }]);
    await resolverAreas(['1', '1', 'no-es-un-id', '-3']);
    expect(repository.findAreasByIds).toHaveBeenCalledWith([1]);
  });

  it('resolverAreas sin ids no llega al repository', async () => {
    const result = await resolverAreas(undefined);
    expect(result).toEqual([]);
    expect(repository.findAreasByIds).not.toHaveBeenCalled();
  });
});

describe('doctores.service.crear (US-607)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.crear.mockResolvedValue(99);
  });

  it('inserta al doctor con las áreas seleccionadas normalizadas', async () => {
    await crear({
      nombre: '  Ana  ',
      apellidos: '  Gómez  ',
      activo: 'true',
      areaIds: ['1', '2', '2'],
      usuarioId: 3,
    });

    expect(repository.crear).toHaveBeenCalledWith({
      nombre: 'Ana',
      apellidos: 'Gómez',
      activo: true,
      areaIds: [1, 2],
      usuarioId: 3,
    });
  });

  it('AC: guardar sin ninguna área seleccionada se permite igual (areaIds vacío)', async () => {
    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      activo: 'true',
      areaIds: undefined,
      usuarioId: 3,
    });
    expect(repository.crear).toHaveBeenCalledWith(expect.objectContaining({ areaIds: [] }));
  });

  it('el checkbox "Activo" ausente (desmarcado) se interpreta como false, no como error', async () => {
    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      activo: undefined,
      areaIds: [],
      usuarioId: 3,
    });
    expect(repository.crear).toHaveBeenCalledWith(expect.objectContaining({ activo: false }));
  });

  it('rechaza un nombre vacío sin llegar al repository', async () => {
    await expect(
      crear({ nombre: '   ', apellidos: 'Gómez', activo: 'true', areaIds: [], usuarioId: 3 }),
    ).rejects.toThrow(DoctorValidationError);
    expect(repository.crear).not.toHaveBeenCalled();
  });

  it('rechaza apellidos vacíos sin llegar al repository', async () => {
    await expect(
      crear({ nombre: 'Ana', apellidos: '  ', activo: 'true', areaIds: [], usuarioId: 3 }),
    ).rejects.toThrow(DoctorValidationError);
    expect(repository.crear).not.toHaveBeenCalled();
  });

  it('rechaza un nombre de más de 100 caracteres', async () => {
    await expect(
      crear({
        nombre: 'a'.repeat(101),
        apellidos: 'Gómez',
        activo: 'true',
        areaIds: [],
        usuarioId: 3,
      }),
    ).rejects.toThrow(DoctorValidationError);
  });
});

describe('doctores.service.editar (US-607)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.editar.mockResolvedValue();
  });

  it('actualiza nombre/apellidos/activo y sustituye la selección de áreas', async () => {
    await editar({
      id: '5',
      nombre: 'Ana',
      apellidos: 'Gómez',
      activo: 'true',
      areaIds: ['1'],
      usuarioId: 2,
    });

    expect(repository.editar).toHaveBeenCalledWith({
      id: '5',
      nombre: 'Ana',
      apellidos: 'Gómez',
      activo: true,
      areaIds: [1],
      usuarioId: 2,
    });
  });

  it('rechaza apellidos vacíos sin llegar al repository', async () => {
    await expect(
      editar({ id: '5', nombre: 'Ana', apellidos: '', activo: 'true', areaIds: [], usuarioId: 2 }),
    ).rejects.toThrow(DoctorValidationError);
    expect(repository.editar).not.toHaveBeenCalled();
  });
});
