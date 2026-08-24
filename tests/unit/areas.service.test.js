jest.mock('../../src/modules/areas/areas.repository');
const repository = require('../../src/modules/areas/areas.repository');
const {
  list,
  desactivar,
  crear,
  editar,
  AreaValidationError,
  DuplicateNombreError,
} = require('../../src/modules/areas/areas.service');
const db = require('../../src/config/database');

afterAll(() => db.destroy());

describe('areas.service.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    repository.findPage.mockResolvedValue([]);
  });

  it('por defecto filtra solo activas', async () => {
    await list({});
    expect(repository.findPage).toHaveBeenCalledWith(expect.objectContaining({ activoOnly: true }));
  });

  it('estado=todos desactiva el filtro de activas', async () => {
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
    repository.count.mockResolvedValue(5); // 5 áreas, PAGE_SIZE=10 => 1 sola página
    const result = await list({ page: '99' });
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('catalogoVacio es true solo cuando no existe ningún área (sin importar filtros)', async () => {
    repository.existsAny.mockResolvedValue(false);
    const result = await list({});
    expect(result.catalogoVacio).toBe(true);
  });

  it('catalogoVacio es false si hay áreas aunque esta búsqueda no encuentre nada', async () => {
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    const result = await list({ q: 'no-coincide-con-nada' });
    expect(result.catalogoVacio).toBe(false);
    expect(result.total).toBe(0);
  });

  it('por defecto ordena por nombre ascendente', async () => {
    const result = await list({});
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'nombre', dir: 'asc' }),
    );
    expect(result.sort).toBe('nombre');
    expect(result.dir).toBe('asc');
  });

  it.each([['nombre'], ['slug'], ['estado']])('acepta ordenar por %s', async (column) => {
    await list({ sort: column, dir: 'desc' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ sort: column, dir: 'desc' }),
    );
  });

  it('una columna de orden desconocida cae a "nombre", no truena', async () => {
    const result = await list({ sort: 'algo-que-no-existe' });
    expect(result.sort).toBe('nombre');
  });

  it('una dirección desconocida cae a "asc"', async () => {
    const result = await list({ dir: 'algo-raro' });
    expect(result.dir).toBe('asc');
  });
});

describe('areas.service.desactivar (US-611)', () => {
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

describe('areas.service.crear (US-610)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findAllExcept.mockResolvedValue([]);
    repository.existsBySlug.mockResolvedValue(false);
    repository.create.mockResolvedValue(99);
    repository.reactivar.mockResolvedValue();
  });

  it('genera el slug a partir del nombre, sin acentos y en minúsculas', async () => {
    await crear({ nombre: 'Cardiología', usuarioId: 1 });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Cardiología', slug: 'cardiologia', usuarioId: 1 }),
    );
  });

  it('guarda el color de Google Calendar elegido', async () => {
    await crear({ nombre: 'Cardiología', color: '7', usuarioId: 1 });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ color: '7' }));
  });

  it("un color ausente o inválido cae a 'Sin color' (null), no truena", async () => {
    await crear({ nombre: 'Cardiología', color: 'no-es-un-color', usuarioId: 1 });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ color: null }));

    await crear({ nombre: 'Dermatología', usuarioId: 1 });
    expect(repository.create).toHaveBeenLastCalledWith(expect.objectContaining({ color: null }));
  });

  it('si el slug base ya existe (dos nombres distintos que normalizan igual), le agrega un sufijo', async () => {
    repository.existsBySlug
      .mockResolvedValueOnce(true) // "cardiologia" ocupado
      .mockResolvedValueOnce(true) // "cardiologia-2" ocupado
      .mockResolvedValueOnce(false); // "cardiologia-3" libre

    await crear({ nombre: 'Cardiología', usuarioId: 1 });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'cardiologia-3' }),
    );
  });

  it('recorta espacios del nombre antes de guardar', async () => {
    await crear({ nombre: '  Nutrición  ', usuarioId: 1 });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Nutrición' }),
    );
  });

  it('rechaza un nombre vacío sin llegar al repository', async () => {
    await expect(crear({ nombre: '   ', usuarioId: 1 })).rejects.toThrow(AreaValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza un nombre de más de 100 caracteres', async () => {
    await expect(crear({ nombre: 'a'.repeat(101), usuarioId: 1 })).rejects.toThrow(
      AreaValidationError,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza un nombre ya usado por un área activa (AC de duplicados)', async () => {
    repository.findAllExcept.mockResolvedValue([{ id: 7, nombre: 'Cardiología', activo: true }]);
    await expect(crear({ nombre: 'Cardiología', usuarioId: 1 })).rejects.toThrow(
      DuplicateNombreError,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('reactiva (no crea una fila nueva) si el nombre pertenece a un área ya dada de baja', async () => {
    repository.findAllExcept.mockResolvedValue([{ id: 7, nombre: 'Cardiología', activo: false }]);

    const id = await crear({ nombre: 'Cardiología', color: '3', usuarioId: 1 });

    expect(repository.reactivar).toHaveBeenCalledWith(7, 'Cardiología', '3', 1);
    expect(repository.create).not.toHaveBeenCalled();
    expect(id).toBe(7); // el id del registro reactivado, no uno nuevo
  });

  it('detecta un duplicado aunque difiera en acentos, mayúsculas o espacios', async () => {
    repository.findAllExcept.mockResolvedValue([{ id: 7, nombre: 'Neurología', activo: true }]);
    await expect(crear({ nombre: '  neuro logia  ', usuarioId: 1 })).rejects.toThrow(
      DuplicateNombreError,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('areas.service.editar (US-610)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findAllExcept.mockResolvedValue([]);
    repository.updateNombre.mockResolvedValue();
  });

  it('actualiza el nombre sin tocar el slug', async () => {
    await editar({ id: 5, nombre: 'Nuevo Nombre', color: '2', usuarioId: 2 });
    expect(repository.updateNombre).toHaveBeenCalledWith(5, 'Nuevo Nombre', '2', 2);
    expect(repository.existsBySlug).not.toHaveBeenCalled();
  });

  it("un color ausente o inválido cae a 'Sin color' (null), no truena", async () => {
    await editar({ id: 5, nombre: 'Nuevo Nombre', color: 'algo-invalido', usuarioId: 2 });
    expect(repository.updateNombre).toHaveBeenCalledWith(5, 'Nuevo Nombre', null, 2);
  });

  it('excluye el propio id al chequear duplicados', async () => {
    await editar({ id: 5, nombre: 'Cardiología', usuarioId: 2 });
    expect(repository.findAllExcept).toHaveBeenCalledWith(5);
  });

  it('rechaza un nombre ya usado por otra área activa', async () => {
    repository.findAllExcept.mockResolvedValue([{ id: 7, nombre: 'Cardiología', activo: true }]);
    await expect(editar({ id: 5, nombre: 'Cardiología', usuarioId: 2 })).rejects.toThrow(
      DuplicateNombreError,
    );
    expect(repository.updateNombre).not.toHaveBeenCalled();
  });

  it('rechaza un nombre ya usado por otra área INACTIVA también (no hay reactivar al editar)', async () => {
    repository.findAllExcept.mockResolvedValue([{ id: 7, nombre: 'Cardiología', activo: false }]);
    await expect(editar({ id: 5, nombre: 'Cardiología', usuarioId: 2 })).rejects.toThrow(
      DuplicateNombreError,
    );
    expect(repository.updateNombre).not.toHaveBeenCalled();
  });

  it('rechaza un nombre que solo difiere en acentos/mayúsculas/espacios de otra área', async () => {
    repository.findAllExcept.mockResolvedValue([{ id: 7, nombre: 'Neurología', activo: true }]);
    await expect(editar({ id: 5, nombre: 'neurologia', usuarioId: 2 })).rejects.toThrow(
      DuplicateNombreError,
    );
    expect(repository.updateNombre).not.toHaveBeenCalled();
  });

  it('rechaza un nombre vacío', async () => {
    await expect(editar({ id: 5, nombre: '', usuarioId: 2 })).rejects.toThrow(AreaValidationError);
  });
});
