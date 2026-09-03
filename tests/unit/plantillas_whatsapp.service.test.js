jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
jest.mock('../../src/config/whatsapp');
const repository = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
const whatsappConfig = require('../../src/config/whatsapp');
const {
  list,
  obtener,
  desactivar,
  crear,
  editar,
  nombreMeta,
  PlantillaValidationError,
  DuplicateIntencionError,
  PlantillaPredeterminadaError,
} = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.service');
const db = require('../../src/config/database');

afterAll(() => db.destroy());

describe('plantillas_whatsapp.service.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    repository.findPage.mockResolvedValue([]);
  });

  it('AC: por defecto el filtro es "Activos" (activoOnly=true) — cambio explícito del usuario, igual que doctores/áreas', async () => {
    const result = await list({});
    expect(repository.findPage).toHaveBeenCalledWith(expect.objectContaining({ activoOnly: true }));
    expect(result.estado).toBe('activos');
  });

  it('estado=activos SÍ activa el filtro de activas', async () => {
    await list({ estado: 'activos' });
    expect(repository.findPage).toHaveBeenCalledWith(expect.objectContaining({ activoOnly: true }));
  });

  it('estado=todos SÍ desactiva el filtro de activas', async () => {
    const result = await list({ estado: 'todos' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ activoOnly: false }),
    );
    expect(result.estado).toBe('todos');
  });

  it('cualquier otro valor de estado (no solo "activos"/"todos") cae al comportamiento por defecto: activos', async () => {
    const result = await list({ estado: 'lo-que-sea' });
    expect(repository.findPage).toHaveBeenCalledWith(expect.objectContaining({ activoOnly: true }));
    expect(result.estado).toBe('activos');
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
    repository.count.mockResolvedValue(5); // 5 plantillas, PAGE_SIZE=10 => 1 sola página
    const result = await list({ page: '99' });
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('catalogoVacio es true solo cuando no existe ninguna plantilla (sin importar filtros)', async () => {
    repository.existsAny.mockResolvedValue(false);
    const result = await list({});
    expect(result.catalogoVacio).toBe(true);
  });

  it('catalogoVacio es false si hay plantillas aunque esta búsqueda no encuentre nada', async () => {
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    const result = await list({ q: 'no-coincide-con-nada' });
    expect(result.catalogoVacio).toBe(false);
    expect(result.total).toBe(0);
  });

  it('por defecto ordena por intención ascendente', async () => {
    const result = await list({});
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'intencion', dir: 'asc' }),
    );
    expect(result.sort).toBe('intencion');
    expect(result.dir).toBe('asc');
  });

  it.each([['intencion'], ['slug'], ['estado_meta'], ['estado']])(
    'acepta ordenar por %s',
    async (column) => {
      await list({ sort: column, dir: 'desc' });
      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ sort: column, dir: 'desc' }),
      );
    },
  );

  it('una columna de orden desconocida cae a "intencion", no truena', async () => {
    const result = await list({ sort: 'algo-que-no-existe' });
    expect(result.sort).toBe('intencion');
  });

  it('una dirección desconocida cae a "asc"', async () => {
    const result = await list({ dir: 'algo-raro' });
    expect(result.dir).toBe('asc');
  });
});

describe('plantillas_whatsapp.service.obtener (US-613)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delega en el repository con el id ya parseado', async () => {
    repository.findById.mockResolvedValue({ id: 7, intencion: 'Confirmar cita' });
    const result = await obtener('7');
    expect(repository.findById).toHaveBeenCalledWith(7);
    expect(result).toEqual({ id: 7, intencion: 'Confirmar cita' });
  });

  it('un id inválido no llega al repository, devuelve undefined', async () => {
    const result = await obtener('no-es-un-numero');
    expect(result).toBeUndefined();
    expect(repository.findById).not.toHaveBeenCalled();
  });
});

describe('plantillas_whatsapp.service.desactivar (US-614)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findById.mockResolvedValue({ id: 7, es_predeterminada: false });
  });

  it('delega en el repository con el id ya parseado y el usuario que ejecuta la baja', async () => {
    await desactivar('7', 42);
    expect(repository.desactivar).toHaveBeenCalledWith(7, 42);
  });

  it('un id inválido no truena y no llega al repository', async () => {
    await desactivar('no-es-un-numero', 42);
    expect(repository.desactivar).not.toHaveBeenCalled();
  });

  it('un id inexistente no truena y no llega al repository.desactivar', async () => {
    repository.findById.mockResolvedValue(undefined);
    await desactivar('7', 42);
    expect(repository.desactivar).not.toHaveBeenCalled();
  });

  it('rechaza una plantilla predeterminada del sistema (es_predeterminada), nunca llega a repository.desactivar', async () => {
    repository.findById.mockResolvedValue({ id: 7, es_predeterminada: true });

    await expect(desactivar('7', 42)).rejects.toThrow(PlantillaPredeterminadaError);
    expect(repository.desactivar).not.toHaveBeenCalled();
  });
});

describe('plantillas_whatsapp.service.crear (US-613)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findAllExcept.mockResolvedValue([]);
    repository.existsBySlug.mockResolvedValue(false);
    repository.create.mockResolvedValue(99);
    repository.reactivar.mockResolvedValue();
  });

  it('inserta la plantilla con intención/texto_respuesta recortados y un slug generado a partir de la intención', async () => {
    await crear({
      intencion: '  Confirmar Cita  ',
      texto_respuesta: '  Tu cita fue confirmada.  ',
      usuarioId: 1,
    });

    expect(repository.create).toHaveBeenCalledWith({
      intencion: 'Confirmar Cita',
      slug: 'confirmar-cita',
      texto_respuesta: 'Tu cita fue confirmada.',
      usuarioId: 1,
    });
  });

  it('si el slug base ya existe (dos intenciones distintas que normalizan igual), le agrega un sufijo', async () => {
    repository.existsBySlug
      .mockResolvedValueOnce(true) // "confirmar-cita" ocupado
      .mockResolvedValueOnce(true) // "confirmar-cita-2" ocupado
      .mockResolvedValueOnce(false); // "confirmar-cita-3" libre

    await crear({ intencion: 'Confirmar Cita', texto_respuesta: 'algo', usuarioId: 1 });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'confirmar-cita-3' }),
    );
  });

  it('rechaza una intención vacía sin llegar al repository', async () => {
    await expect(
      crear({ intencion: '   ', texto_respuesta: 'algo', usuarioId: 1 }),
    ).rejects.toThrow(PlantillaValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza un texto de respuesta vacío sin llegar al repository', async () => {
    await expect(
      crear({ intencion: 'Confirmar cita', texto_respuesta: '  ', usuarioId: 1 }),
    ).rejects.toThrow(PlantillaValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza una intención de más de 100 caracteres', async () => {
    await expect(
      crear({ intencion: 'a'.repeat(101), texto_respuesta: 'algo', usuarioId: 1 }),
    ).rejects.toThrow(PlantillaValidationError);
  });

  it('no limita la longitud del texto de respuesta (columna text, no varchar)', async () => {
    await crear({ intencion: 'Confirmar cita', texto_respuesta: 'a'.repeat(5000), usuarioId: 1 });
    expect(repository.create).toHaveBeenCalled();
  });

  it('rechaza una intención ya usada por una plantilla activa (AC de duplicados)', async () => {
    repository.findAllExcept.mockResolvedValue([
      { id: 7, intencion: 'Confirmar cita', activo: true },
    ]);
    await expect(
      crear({ intencion: 'Confirmar cita', texto_respuesta: 'algo', usuarioId: 1 }),
    ).rejects.toThrow(DuplicateIntencionError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('detecta un duplicado aunque difiera en acentos, mayúsculas o espacios', async () => {
    repository.findAllExcept.mockResolvedValue([
      { id: 7, intencion: 'Confirmación de cita', activo: true },
    ]);
    await expect(
      crear({ intencion: '  confirmacion   de cita  ', texto_respuesta: 'algo', usuarioId: 1 }),
    ).rejects.toThrow(DuplicateIntencionError);
  });

  it('reactiva (no crea una fila nueva) si la intención pertenece a una plantilla ya dada de baja', async () => {
    repository.findAllExcept.mockResolvedValue([
      { id: 7, intencion: 'Confirmar cita', activo: false },
    ]);

    const id = await crear({ intencion: 'Confirmar cita', texto_respuesta: 'algo', usuarioId: 1 });

    expect(repository.reactivar).toHaveBeenCalledWith(7, 'Confirmar cita', 1);
    expect(repository.create).not.toHaveBeenCalled();
    expect(id).toBe(7);
  });
});

describe('plantillas_whatsapp.service — nombreMeta', () => {
  it('cambia guiones por guion_bajo (Meta exige minúsculas/números/guion_bajo)', () => {
    expect(nombreMeta('confirmar-cita')).toBe('confirmar_cita');
  });
});

describe('plantillas_whatsapp.service.crear — registro en Meta (aprobado_meta)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findAllExcept.mockResolvedValue([]);
    repository.existsBySlug.mockResolvedValue(false);
    repository.create.mockResolvedValue(99);
    repository.reactivar.mockResolvedValue();
    whatsappConfig.isWhatsappConfigured.mockReturnValue(true);
    whatsappConfig.templatesUrl.mockReturnValue(
      'https://graph.facebook.com/fake/message_templates',
    );
    whatsappConfig.authHeaders.mockReturnValue({ Authorization: 'Bearer fake' });
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: '1', status: 'PENDING' }) });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('al crear una plantilla nueva, la manda a registrar a Meta con el name derivado del slug', async () => {
    await crear({
      intencion: 'Confirmar Cita',
      texto_respuesta: 'Tu cita fue confirmada.',
      usuarioId: 1,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/fake/message_templates',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      name: 'confirmar_cita',
      language: 'es_MX',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Tu cita fue confirmada.' }],
    });
  });

  it('si WhatsApp no está configurado, no intenta registrar nada en Meta', async () => {
    whatsappConfig.isWhatsappConfigured.mockReturnValue(false);

    await crear({ intencion: 'Confirmar cita', texto_respuesta: 'algo', usuarioId: 1 });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('si Meta rechaza el registro, la plantilla igual se crea (nunca lanza)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: {} }) });

    const id = await crear({ intencion: 'Confirmar cita', texto_respuesta: 'algo', usuarioId: 1 });

    expect(id).toBe(99);
  });

  it('si el fetch a Meta truena (red caída), la plantilla igual se crea', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const id = await crear({ intencion: 'Confirmar cita', texto_respuesta: 'algo', usuarioId: 1 });

    expect(id).toBe(99);
  });

  it('al reactivar una plantilla dada de baja, registra en Meta con el texto YA GUARDADO, no el del formulario', async () => {
    repository.findAllExcept.mockResolvedValue([
      {
        id: 7,
        intencion: 'Confirmar cita',
        activo: false,
        slug: 'confirmar-cita',
        texto_respuesta: 'Texto viejo guardado.',
      },
    ]);

    await crear({
      intencion: 'Confirmar cita',
      texto_respuesta: 'Texto nuevo del formulario, no debería usarse',
      usuarioId: 1,
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.components[0].text).toBe('Texto viejo guardado.');
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('plantillas_whatsapp.service.editar (US-613, ampliada: intención/slug inmutables)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.update.mockResolvedValue();
  });

  it('actualiza SOLO texto_respuesta/activo — intención/slug no se tocan (no viajan como parámetro siquiera)', async () => {
    await editar({
      id: 5,
      texto_respuesta: 'Nuevo texto',
      activo: 'true',
      usuarioId: 2,
    });

    expect(repository.update).toHaveBeenCalledWith(5, {
      texto_respuesta: 'Nuevo texto',
      activo: true,
      usuarioId: 2,
    });
  });

  it('el switch Activo ausente (desmarcado) se interpreta como false, no como error', async () => {
    await editar({
      id: 5,
      texto_respuesta: 'Nuevo texto',
      activo: undefined,
      usuarioId: 2,
    });

    expect(repository.update).toHaveBeenCalledWith(5, expect.objectContaining({ activo: false }));
  });

  it('nunca consulta el catálogo para chequear duplicados (a diferencia de crear() — intención ya no es editable)', async () => {
    await editar({ id: 5, texto_respuesta: 'algo', activo: 'true', usuarioId: 2 });
    expect(repository.findAllExcept).not.toHaveBeenCalled();
  });

  it('rechaza un texto de respuesta vacío', async () => {
    await expect(
      editar({ id: 5, texto_respuesta: '', activo: 'true', usuarioId: 2 }),
    ).rejects.toThrow(PlantillaValidationError);
  });

  it('una plantilla predeterminada del sistema (esPredeterminada) siempre se guarda activo=true, aunque el switch mande false', async () => {
    await editar({
      id: 5,
      texto_respuesta: 'Nuevo texto',
      activo: undefined, // switch desmarcado/ausente — normalmente sería false
      esPredeterminada: true,
      usuarioId: 2,
    });

    expect(repository.update).toHaveBeenCalledWith(5, expect.objectContaining({ activo: true }));
  });
});
