jest.mock('../../src/modules/doctores/doctores.repository');
const repository = require('../../src/modules/doctores/doctores.repository');
const { list, desactivar } = require('../../src/modules/doctores/doctores.service');
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
