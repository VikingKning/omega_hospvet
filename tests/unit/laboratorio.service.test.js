jest.mock('../../src/modules/laboratorio/laboratorio.repository');
jest.mock('../../src/modules/laboratorio/laboratorio.archivos');
jest.mock('../../src/modules/tutores/tutores.repository');
jest.mock('../../src/modules/tutores/tutores.service');
jest.mock('../../src/modules/doctores/doctores.repository');
const repository = require('../../src/modules/laboratorio/laboratorio.repository');
const archivos = require('../../src/modules/laboratorio/laboratorio.archivos');
const tutoresRepository = require('../../src/modules/tutores/tutores.repository');
const tutoresService = require('../../src/modules/tutores/tutores.service');
const doctoresRepository = require('../../src/modules/doctores/doctores.repository');
const {
  list,
  crear,
  editar,
  obtenerParaEditar,
  resolverTutorPorTelefono,
  eliminar,
  listarDoctoresActivos,
  catalogoParaFormulario,
  subirArchivoParaTodos,
  subirArchivoParaEstudio,
  eliminarArchivoDeTodos,
  eliminarArchivoDeEstudio,
  obtenerArchivoParaDescarga,
} = require('../../src/modules/laboratorio/laboratorio.service');

const MASCOTA = { id: 11, nombre: 'Cachis', propietario_id: 6 };
const ZONAS = [
  { id: 127, codigo: 'abdomen', nombre: 'Abdomen' },
  { id: 128, codigo: 'torax', nombre: 'Tórax' },
];
const FECHA_VALIDA = '2026-08-27';

function estudio(id, campoAdicional, overrides = {}) {
  return {
    id,
    nombre: `Estudio ${id}`,
    campo_adicional: campoAdicional,
    activo: true,
    ...overrides,
  };
}

describe('laboratorio.service.crear', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tutoresRepository.findMascotaById.mockResolvedValue(MASCOTA);
    repository.findZonasAnatomicas.mockResolvedValue(ZONAS);
    repository.crearRegistro.mockResolvedValue(99);
  });

  it('rechaza si no hay mascotaId', async () => {
    await expect(
      crear({
        mascotaId: '',
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 1 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('Selecciona un paciente.');
  });

  it('rechaza si la mascota no existe', async () => {
    tutoresRepository.findMascotaById.mockResolvedValue(undefined);
    await expect(
      crear({
        mascotaId: 999,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 1 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('El paciente seleccionado no existe.');
  });

  it('rechaza si no hay doctorId', async () => {
    await expect(
      crear({
        mascotaId: 11,
        doctorId: '',
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 1 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('Selecciona el doctor solicitante.');
  });

  // Pedido explícito del usuario (mockup de pantalla completa): la fecha de
  // solicitud ya no la fija el servidor, la captura el formulario.
  it('rechaza si no hay fechaSolicitud o no tiene formato de fecha', async () => {
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: '',
        estudios: [{ estudioId: 1 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('La fecha de solicitud es obligatoria y debe ser una fecha válida.');
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: '27/08/2026',
        estudios: [{ estudioId: 1 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('La fecha de solicitud es obligatoria y debe ser una fecha válida.');
  });

  it('rechaza si no se agregó ningún estudio', async () => {
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [],
        usuarioId: 1,
      }),
    ).rejects.toThrow('Agrega al menos un estudio antes de guardar.');
  });

  it('rechaza si el estudio ya no existe o está inactivo en el catálogo', async () => {
    repository.findEstudiosByIds.mockResolvedValue([]);
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 404 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('Uno de los estudios seleccionados ya no está disponible en el catálogo.');
  });

  // Bug real ya encontrado en el mock original: se podía agregar un estudio
  // que exige zona (ej. Radiografía) sin ninguna zona, y el carrito
  // mostraba literalmente "undefined" — el service ahora rechaza el alta
  // completa si falta el campo adicional obligatorio de cualquier estudio.
  it('rechaza un estudio con campo_adicional=zona sin zonaAnatomicaId', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(1, 'zona')]);
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 1 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('"Estudio 1" requiere seleccionar una zona anatómica.');
  });

  it('rechaza una zonaAnatomicaId que no pertenece al catálogo real', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(1, 'zona')]);
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 1, zonaAnatomicaId: 9999 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('"Estudio 1" requiere seleccionar una zona anatómica.');
  });

  it('rechaza un estudio con campo_adicional=tipo_muestra sin tipoMuestra', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(2, 'tipo_muestra')]);
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 2 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('"Estudio 2" requiere indicar el tipo de muestra.');
  });

  it('rechaza un estudio con campo_adicional=tejido_lateralidad sin tejidoOrigen', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(3, 'tejido_lateralidad')]);
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 3 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('"Estudio 3" requiere indicar el tejido de origen.');
  });

  it('rechaza un estudio con campo_adicional=componentes_liquido sin componentes', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(4, 'componentes_liquido')]);
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 4, componentesLiquido: [] }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('"Estudio 4" requiere seleccionar al menos un componente.');
  });

  it('rechaza componentesLiquido si ninguno pertenece a la whitelist real', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(4, 'componentes_liquido')]);
    await expect(
      crear({
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 4, componentesLiquido: ['valor_inventado'] }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('"Estudio 4" requiere seleccionar al menos un componente.');
  });

  it('arma correctamente los 4 tipos de campo adicional + observaciones y llama a crearRegistro', async () => {
    repository.findEstudiosByIds.mockResolvedValue([
      estudio(1, 'zona'),
      estudio(2, 'tipo_muestra'),
      estudio(3, 'tejido_lateralidad'),
      estudio(4, 'componentes_liquido'),
      estudio(5, null), // sin campo adicional
    ]);

    await crear({
      mascotaId: 11,
      doctorId: 7,
      fechaSolicitud: FECHA_VALIDA,
      observaciones: '  Paciente ansioso  ',
      usuarioId: 1,
      estudios: [
        { estudioId: 1, zonaAnatomicaId: 127 },
        { estudioId: 2, tipoMuestra: 'Hisopo de piel', antibiograma: true },
        { estudioId: 3, tejidoOrigen: 'Nódulo cutáneo', lateralidad: 'izquierdo' },
        { estudioId: 4, componentesLiquido: ['color', 'inventado', 'citologia'] },
        { estudioId: 5, observaciones: '  Ayuno de 8 horas  ' },
      ],
    });

    expect(repository.crearRegistro).toHaveBeenCalledWith({
      mascotaId: 11,
      doctorId: 7,
      fechaSolicitud: FECHA_VALIDA,
      observaciones: 'Paciente ansioso',
      usuarioId: 1,
      estudios: [
        { estudioId: 1, zonaAnatomicaId: 127 },
        { estudioId: 2, tipoMuestra: 'Hisopo de piel', antibiograma: true },
        { estudioId: 3, tejidoOrigen: 'Nódulo cutáneo', lateralidad: 'izquierdo' },
        { estudioId: 4, componentesLiquido: ['color', 'citologia'] },
        { estudioId: 5, observaciones: 'Ayuno de 8 horas' },
      ],
    });
  });

  it('descarta una lateralidad fuera de la whitelist en vez de rechazar el alta (es opcional)', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(3, 'tejido_lateralidad')]);
    await crear({
      mascotaId: 11,
      doctorId: 7,
      fechaSolicitud: FECHA_VALIDA,
      usuarioId: 1,
      estudios: [{ estudioId: 3, tejidoOrigen: 'Ganglio', lateralidad: 'valor_invalido' }],
    });
    expect(repository.crearRegistro).toHaveBeenCalledWith(
      expect.objectContaining({
        estudios: [{ estudioId: 3, tejidoOrigen: 'Ganglio' }],
      }),
    );
  });

  it('antibiograma por default es false si no se manda', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(2, 'tipo_muestra')]);
    await crear({
      mascotaId: 11,
      doctorId: 7,
      fechaSolicitud: FECHA_VALIDA,
      usuarioId: 1,
      estudios: [{ estudioId: 2, tipoMuestra: 'Orina' }],
    });
    expect(repository.crearRegistro).toHaveBeenCalledWith(
      expect.objectContaining({
        estudios: [{ estudioId: 2, tipoMuestra: 'Orina', antibiograma: false }],
      }),
    );
  });
});

describe('laboratorio.service.editar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tutoresRepository.findMascotaById.mockResolvedValue(MASCOTA);
    repository.findZonasAnatomicas.mockResolvedValue(ZONAS);
    repository.findEstudiosByIds.mockResolvedValue([estudio(5, null)]);
  });

  it('rechaza un id inválido (a diferencia de eliminar, aquí SÍ es un error, no un no-op)', async () => {
    await expect(
      editar('no-es-numero', {
        mascotaId: 11,
        doctorId: 1,
        fechaSolicitud: FECHA_VALIDA,
        estudios: [{ estudioId: 5 }],
        usuarioId: 1,
      }),
    ).rejects.toThrow('Registro no encontrado.');
    expect(repository.actualizarRegistro).not.toHaveBeenCalled();
  });

  it('valida los datos igual que crear() y llama a repository.actualizarRegistro con el id', async () => {
    await editar('42', {
      mascotaId: 11,
      doctorId: 7,
      fechaSolicitud: FECHA_VALIDA,
      observaciones: 'Revisión de seguimiento',
      usuarioId: 3,
      estudios: [{ estudioId: 5 }],
    });

    expect(repository.actualizarRegistro).toHaveBeenCalledWith(42, {
      mascotaId: 11,
      doctorId: 7,
      fechaSolicitud: FECHA_VALIDA,
      observaciones: 'Revisión de seguimiento',
      usuarioId: 3,
      estudios: [{ estudioId: 5 }],
    });
  });

  it('rechaza igual que crear() si falta un campo adicional obligatorio', async () => {
    repository.findEstudiosByIds.mockResolvedValue([estudio(1, 'zona')]);
    await expect(
      editar('42', {
        mascotaId: 11,
        doctorId: 7,
        fechaSolicitud: FECHA_VALIDA,
        usuarioId: 3,
        estudios: [{ estudioId: 1 }],
      }),
    ).rejects.toThrow('"Estudio 1" requiere seleccionar una zona anatómica.');
    expect(repository.actualizarRegistro).not.toHaveBeenCalled();
  });
});

describe('laboratorio.service.obtenerParaEditar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('un id inválido devuelve undefined sin tocar el repository', async () => {
    const result = await obtenerParaEditar('no-es-un-id');
    expect(result).toBeUndefined();
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('un id inexistente devuelve undefined', async () => {
    repository.findById.mockResolvedValue(undefined);
    expect(await obtenerParaEditar('999')).toBeUndefined();
  });

  it('agrega pacientesDelTutor (todas las mascotas del mismo tutor, con edad calculada)', async () => {
    repository.findById.mockResolvedValue({ id: 42, propietario_id: 6, mascota_id: 11 });
    tutoresService.obtenerPacientesConEdad.mockResolvedValue([
      { id: 11, nombre: 'Cachis', edad: 3 },
      { id: 12, nombre: 'Michi', edad: 1 },
    ]);

    const result = await obtenerParaEditar('42');

    expect(tutoresService.obtenerPacientesConEdad).toHaveBeenCalledWith(6);
    expect(result.pacientesDelTutor).toEqual([
      { id: 11, nombre: 'Cachis', edad: 3 },
      { id: 12, nombre: 'Michi', edad: 1 },
    ]);
  });
});

describe('laboratorio.service.resolverTutorPorTelefono', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delega en tutoresService.resolverTutorActivoPorTelefono', async () => {
    tutoresService.resolverTutorActivoPorTelefono.mockResolvedValue({
      id: 6,
      nombre: 'Jimena Lozada',
    });
    const result = await resolverTutorPorTelefono('55-1234-5678');
    expect(tutoresService.resolverTutorActivoPorTelefono).toHaveBeenCalledWith('55-1234-5678');
    expect(result).toEqual({ id: 6, nombre: 'Jimena Lozada' });
  });
});

describe('laboratorio.service.list', () => {
  beforeEach(() => jest.clearAllMocks());

  it('aplica valores por defecto y arma catalogoVacio a partir de existsAny', async () => {
    repository.findPage.mockResolvedValue([]);
    repository.count.mockResolvedValue(0);
    repository.existsAny.mockResolvedValue(false);
    repository.estudiosPorRegistros.mockResolvedValue([]);

    const data = await list({});

    expect(data.catalogoVacio).toBe(true);
    expect(data.page).toBe(1);
    expect(data.sort).toBe('fecha');
    expect(data.dir).toBe('desc');
    expect(data.registros).toEqual([]);
  });

  it('agrupa los estudios de estudiosPorRegistros dentro de cada registro', async () => {
    repository.findPage.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    repository.count.mockResolvedValue(2);
    repository.existsAny.mockResolvedValue(true);
    repository.estudiosPorRegistros.mockResolvedValue([
      { registro_laboratorio_id: 1, nombre: 'Hemograma' },
      { registro_laboratorio_id: 1, nombre: 'EGO' },
      { registro_laboratorio_id: 2, nombre: 'Radiografía' },
    ]);

    const data = await list({});

    expect(data.registros[0].estudios).toEqual(['Hemograma', 'EGO']);
    expect(data.registros[1].estudios).toEqual(['Radiografía']);
  });

  it('ignora un estado fuera de la whitelist real', async () => {
    repository.findPage.mockResolvedValue([]);
    repository.count.mockResolvedValue(0);
    repository.existsAny.mockResolvedValue(true);
    repository.estudiosPorRegistros.mockResolvedValue([]);

    const data = await list({ estado: 'valor_inventado' });

    expect(data.estado).toBe('');
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ estado: undefined }),
    );
  });
});

describe('laboratorio.service.eliminar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no hace nada con un id inválido', async () => {
    await eliminar('no-es-numero', 1);
    expect(repository.eliminar).not.toHaveBeenCalled();
  });

  it('llama a repository.eliminar con el id y el usuario', async () => {
    await eliminar('5', 1);
    expect(repository.eliminar).toHaveBeenCalledWith(5, 1);
  });
});

describe('laboratorio.service catálogo/doctores', () => {
  beforeEach(() => jest.clearAllMocks());

  it('listarDoctoresActivos delega en doctoresRepository.findActivos', async () => {
    doctoresRepository.findActivos.mockResolvedValue([
      { id: 1, nombre: 'Ana', apellidos: 'Pérez' },
    ]);
    expect(await listarDoctoresActivos()).toEqual([{ id: 1, nombre: 'Ana', apellidos: 'Pérez' }]);
  });

  it('catalogoParaFormulario incluye la whitelist de componentes de líquido', async () => {
    repository.findCatalogo.mockResolvedValue([]);
    repository.findZonasAnatomicas.mockResolvedValue(ZONAS);
    const catalogo = await catalogoParaFormulario();
    expect(catalogo.componentesLiquido.length).toBeGreaterThan(0);
    expect(catalogo.zonasAnatomicas).toEqual(ZONAS);
  });
});

describe('laboratorio.service.subirArchivoParaTodos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findById.mockResolvedValue({ id: 7, estudios: [{ id: 100 }, { id: 101 }] });
    // US-409 v2: sin coincidencias activas por default — cada test de
    // duplicados de abajo sobreescribe esto explícitamente con lo que
    // necesite.
    archivos.calcularHash.mockReturnValue('hash-sin-conflicto');
    repository.buscarArchivosActivosPorHashes.mockResolvedValue([]);
    archivos.procesarArchivos.mockResolvedValue({
      nombreOriginal: 'resultado.pdf',
      rutaAlmacenamiento: '7/abc.pdf',
      hashContenido: 'hash',
      tamanoBytes: 123,
      consolidado: false,
    });
    repository.registrarArchivoParaTodos.mockResolvedValue(55);
  });

  it('rechaza un id de registro inválido', async () => {
    await expect(subirArchivoParaTodos('no-es-numero', [{}], 1)).rejects.toThrow(
      'Registro no encontrado.',
    );
  });

  it('rechaza si el registro no existe', async () => {
    repository.findById.mockResolvedValue(undefined);
    await expect(subirArchivoParaTodos('7', [{}], 1)).rejects.toThrow('Registro no encontrado.');
  });

  it('crea el archivo, lo asigna a TODOS los estudios y marca cargado si completa', async () => {
    const resultado = await subirArchivoParaTodos('7', [{ originalname: 'a.pdf' }], 9);

    expect(resultado).toEqual({ archivoId: 55, reutilizado: false });
    expect(archivos.procesarArchivos).toHaveBeenCalledWith({
      registroId: 7,
      files: [{ originalname: 'a.pdf' }],
    });
    expect(repository.registrarArchivoParaTodos).toHaveBeenCalledWith({
      registroId: 7,
      usuarioId: 9,
      metadata: expect.objectContaining({ nombreOriginal: 'resultado.pdf' }),
    });
  });

  it('propaga el error de validación de laboratorio.archivos.js (ej. video mezclado con otro archivo)', async () => {
    archivos.procesarArchivos.mockRejectedValue(
      Object.assign(new Error('Tipo no permitido'), { status: 400 }),
    );
    await expect(subirArchivoParaTodos('7', [{}], 1)).rejects.toThrow('Tipo no permitido');
    expect(repository.registrarArchivoParaTodos).not.toHaveBeenCalled();
  });

  // US-409 v2: detección de duplicados por hash — solo ACTIVOS
  // (cargado/enviado), GLOBAL (sin filtrar por tutor/paciente/estudio),
  // con el modelo de estado CARGADO/ENVIADO/RETIRADO.
  describe('US-409: detección de duplicados por hash', () => {
    it('el mismo hash ya activo en ESTE registro (7) se reutiliza — no crea archivo ni fila nueva', async () => {
      archivos.calcularHash.mockReturnValue('hash-repetido');
      repository.buscarArchivosActivosPorHashes.mockResolvedValue([
        { id: 44, hash_contenido: 'hash-repetido', registro_laboratorio_id: 7 },
      ]);

      const resultado = await subirArchivoParaTodos('7', [{ originalname: 'a.pdf' }], 9);

      expect(resultado).toEqual({ archivoId: 44, reutilizado: true });
      expect(archivos.procesarArchivos).not.toHaveBeenCalled();
      expect(repository.registrarArchivoParaTodos).not.toHaveBeenCalled();
      expect(repository.reutilizarArchivoParaTodos).toHaveBeenCalledWith({
        registroId: 7,
        archivoId: 44,
        usuarioId: 9,
      });
    });

    it('el mismo hash activo en OTRO registro (99) rechaza el lote, sin crear nada, y el mensaje trae registro/paciente/doctor', async () => {
      archivos.calcularHash.mockReturnValue('hash-ajeno');
      repository.buscarArchivosActivosPorHashes.mockResolvedValue([
        {
          id: 44,
          hash_contenido: 'hash-ajeno',
          registro_laboratorio_id: 99,
          paciente_nombre: 'Nissa',
          doctor_nombre: 'Juan',
          doctor_apellidos: 'Pérez',
        },
      ]);

      await expect(
        subirArchivoParaTodos('7', [{ originalname: 'resultado.pdf' }], 9),
      ).rejects.toThrow(
        '"resultado.pdf" ya se encuentra asociado a otro registro de laboratorio (LAB-099 — paciente Nissa, Dr. Juan Pérez)',
      );
      expect(archivos.procesarArchivos).not.toHaveBeenCalled();
      expect(repository.registrarArchivoParaTodos).not.toHaveBeenCalled();
      expect(repository.reutilizarArchivoParaTodos).not.toHaveBeenCalled();
    });

    it('en un lote de 2+ archivos, un duplicado activo del MISMO registro también bloquea el lote completo (decisión del usuario)', async () => {
      archivos.calcularHash.mockImplementation((buffer) =>
        buffer === 'buffer-repetido' ? 'hash-repetido' : 'hash-nuevo',
      );
      repository.buscarArchivosActivosPorHashes.mockResolvedValue([
        { id: 44, hash_contenido: 'hash-repetido', registro_laboratorio_id: 7 },
      ]);
      const files = [
        { originalname: 'nuevo.jpg', buffer: 'buffer-nuevo' },
        { originalname: 'repetido.jpg', buffer: 'buffer-repetido' },
      ];

      await expect(subirArchivoParaTodos('7', files, 9)).rejects.toThrow(
        '"repetido.jpg" ya se encuentra cargado en este mismo registro (LAB-007)',
      );
      expect(archivos.procesarArchivos).not.toHaveBeenCalled();
      expect(repository.registrarArchivoParaTodos).not.toHaveBeenCalled();
    });

    it('en un lote de varios archivos, si SOLO uno pertenece a otro registro, rechaza el LOTE COMPLETO nombrando ese archivo (pedido explícito del usuario)', async () => {
      archivos.calcularHash.mockImplementation((buffer) =>
        buffer === 'buffer-ajeno' ? 'hash-ajeno' : 'hash-propio',
      );
      repository.buscarArchivosActivosPorHashes.mockResolvedValue([
        {
          id: 44,
          hash_contenido: 'hash-ajeno',
          registro_laboratorio_id: 99,
          paciente_nombre: 'Nissa',
        },
      ]);
      const files = [
        { originalname: 'ok-1.jpg', buffer: 'buffer-ok-1' },
        { originalname: 'ajeno.jpg', buffer: 'buffer-ajeno' },
        { originalname: 'ok-2.jpg', buffer: 'buffer-ok-2' },
      ];

      await expect(subirArchivoParaTodos('7', files, 9)).rejects.toThrow('"ajeno.jpg"');
      expect(archivos.procesarArchivos).not.toHaveBeenCalled();
      expect(repository.registrarArchivoParaTodos).not.toHaveBeenCalled();
    });

    it('consulta buscarArchivosActivosPorHashes con los hashes ÚNICOS de todos los archivos del lote de un jalón (nunca uno por uno)', async () => {
      archivos.calcularHash.mockImplementation((buffer) => `hash-de-${buffer}`);
      const files = [
        { originalname: 'a.jpg', buffer: 'buf-a' },
        { originalname: 'b.jpg', buffer: 'buf-b' },
      ];

      await subirArchivoParaTodos('7', files, 9);

      expect(repository.buscarArchivosActivosPorHashes).toHaveBeenCalledTimes(1);
      expect(repository.buscarArchivosActivosPorHashes).toHaveBeenCalledWith([
        'hash-de-buf-a',
        'hash-de-buf-b',
      ]);
    });

    // US-409 v2: la carrera real que cierra el índice único parcial — 2
    // cargas concurrentes con el mismo hash en registros distintos. El
    // pre-check ya pasó limpio (por eso llegamos a registrarArchivoParaTodos),
    // pero la transacción truena con la violación del índice.
    it('si registrarArchivoParaTodos truena por una carrera real (índice único), borra el archivo físico y relanza un error de conflicto', async () => {
      const errorCarrera = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'archivos_laboratorio_hash_activo_unique',
      });
      repository.registrarArchivoParaTodos.mockRejectedValue(errorCarrera);
      repository.esViolacionHashActivo.mockReturnValue(true);
      repository.buscarArchivosActivosPorHashes
        .mockResolvedValueOnce([]) // pre-check normal, sin conflicto
        .mockResolvedValueOnce([
          {
            id: 77,
            hash_contenido: 'hash',
            registro_laboratorio_id: 99,
            paciente_nombre: 'Nissa',
            doctor_nombre: 'Juan',
            doctor_apellidos: 'Pérez',
          },
        ]);

      await expect(subirArchivoParaTodos('7', [{ originalname: 'a.pdf' }], 9)).rejects.toThrow(
        'ya se encuentra asociado a otro registro de laboratorio (LAB-099',
      );
      expect(archivos.eliminarFisico).toHaveBeenCalledWith('7/abc.pdf');
    });

    it('si registrarArchivoParaTodos truena por cualquier OTRO motivo, borra el archivo físico y relanza el error original sin traducirlo', async () => {
      const errorInesperado = new Error('la BD se cayó');
      repository.registrarArchivoParaTodos.mockRejectedValue(errorInesperado);
      repository.esViolacionHashActivo.mockReturnValue(false);

      await expect(subirArchivoParaTodos('7', [{ originalname: 'a.pdf' }], 9)).rejects.toThrow(
        'la BD se cayó',
      );
      expect(archivos.eliminarFisico).toHaveBeenCalledWith('7/abc.pdf');
    });
  });
});

describe('laboratorio.service.subirArchivoParaEstudio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findById.mockResolvedValue({ id: 7, estudios: [{ id: 100 }, { id: 101 }] });
    archivos.calcularHash.mockReturnValue('hash-sin-conflicto');
    repository.buscarArchivosActivosPorHashes.mockResolvedValue([]);
    archivos.procesarArchivos.mockResolvedValue({
      nombreOriginal: 'radiografia.jpg',
      rutaAlmacenamiento: '7/def.jpg',
      hashContenido: 'hash2',
      tamanoBytes: 456,
      consolidado: false,
    });
    repository.registrarArchivoParaEstudio.mockResolvedValue(56);
  });

  it('rechaza si el estudio no pertenece a ese registro', async () => {
    await expect(subirArchivoParaEstudio('7', '999', [{}], 1)).rejects.toThrow(
      'Registro no encontrado.',
    );
    expect(repository.registrarArchivoParaEstudio).not.toHaveBeenCalled();
  });

  it('crea el archivo y lo asigna SOLO a ese estudio (no a los demás de la orden)', async () => {
    const resultado = await subirArchivoParaEstudio('7', '101', [{ originalname: 'x.jpg' }], 9);

    expect(resultado).toEqual({ archivoId: 56, reutilizado: false });
    expect(repository.registrarArchivoParaEstudio).toHaveBeenCalledWith({
      registroId: 7,
      estudioId: 101,
      usuarioId: 9,
      metadata: expect.objectContaining({ nombreOriginal: 'radiografia.jpg' }),
    });
  });

  // US-409: misma validación que subirArchivoParaTodos — un solo test aquí
  // basta para confirmar que también está conectada en este 2do camino de
  // carga (la lógica en sí ya se cubrió exhaustivamente arriba).
  it('US-409: un hash activo en OTRO registro también rechaza la carga por estudio', async () => {
    archivos.calcularHash.mockReturnValue('hash-ajeno');
    repository.buscarArchivosActivosPorHashes.mockResolvedValue([
      {
        id: 44,
        hash_contenido: 'hash-ajeno',
        registro_laboratorio_id: 99,
        paciente_nombre: 'Nissa',
      },
    ]);

    await expect(
      subirArchivoParaEstudio('7', '101', [{ originalname: 'x.jpg' }], 9),
    ).rejects.toThrow('ya se encuentra asociado a otro registro de laboratorio');
    expect(repository.registrarArchivoParaEstudio).not.toHaveBeenCalled();
  });

  it('un hash activo en ESTE registro se reutiliza y se asigna a este estudio', async () => {
    archivos.calcularHash.mockReturnValue('hash-repetido');
    repository.buscarArchivosActivosPorHashes.mockResolvedValue([
      { id: 44, hash_contenido: 'hash-repetido', registro_laboratorio_id: 7 },
    ]);

    const resultado = await subirArchivoParaEstudio('7', '101', [{ originalname: 'x.jpg' }], 9);

    expect(resultado).toEqual({ archivoId: 44, reutilizado: true });
    expect(repository.reutilizarArchivoParaEstudio).toHaveBeenCalledWith({
      registroId: 7,
      estudioId: 101,
      archivoId: 44,
      usuarioId: 9,
    });
  });
});

describe('laboratorio.service.eliminarArchivoDeTodos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findById.mockResolvedValue({ id: 7, estudios: [{ id: 100 }, { id: 101 }] });
  });

  it('rechaza un id de registro inválido', async () => {
    await expect(eliminarArchivoDeTodos('no-es-numero', 9)).rejects.toThrow(
      'Registro no encontrado.',
    );
  });

  it('rechaza si el registro no existe', async () => {
    repository.findById.mockResolvedValue(undefined);
    await expect(eliminarArchivoDeTodos('7', 9)).rejects.toThrow('Registro no encontrado.');
  });

  it('desvincula el archivo de TODOS los estudios de la orden, pasando el usuario para la auditoría del retiro', async () => {
    await eliminarArchivoDeTodos('7', 9);
    expect(repository.desasignarArchivoDeTodosLosEstudios).toHaveBeenCalledWith(7, 9);
  });
});

describe('laboratorio.service.eliminarArchivoDeEstudio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findById.mockResolvedValue({ id: 7, estudios: [{ id: 100 }, { id: 101 }] });
  });

  it('rechaza si el estudio no pertenece a ese registro', async () => {
    await expect(eliminarArchivoDeEstudio('7', '999', 9)).rejects.toThrow(
      'Registro no encontrado.',
    );
    expect(repository.desasignarArchivoDeEstudio).not.toHaveBeenCalled();
  });

  it('desvincula el archivo de ese estudio (pasando el usuario) y revisa si el registro debe volver a pendiente', async () => {
    await eliminarArchivoDeEstudio('7', '101', 9);
    expect(repository.desasignarArchivoDeEstudio).toHaveBeenCalledWith(101, 9);
    expect(repository.revertirCargadoSiIncompleto).toHaveBeenCalledWith(7);
  });
});

describe('laboratorio.service.obtenerArchivoParaDescarga', () => {
  beforeEach(() => jest.clearAllMocks());

  it('regresa null con un id inválido', async () => {
    expect(await obtenerArchivoParaDescarga('no-es-numero')).toBeNull();
  });

  it('regresa null si el archivo no existe', async () => {
    repository.findArchivoById.mockResolvedValue(undefined);
    expect(await obtenerArchivoParaDescarga('5')).toBeNull();
  });

  it('regresa nombre original y ruta absoluta cuando existe', async () => {
    repository.findArchivoById.mockResolvedValue({
      id: 5,
      nombre_original: 'r.pdf',
      ruta_almacenamiento: '7/x.pdf',
    });
    archivos.rutaAbsolutaDeArchivo.mockReturnValue('/storage/laboratorio/7/x.pdf');

    expect(await obtenerArchivoParaDescarga('5')).toEqual({
      nombreOriginal: 'r.pdf',
      rutaAbsoluta: '/storage/laboratorio/7/x.pdf',
    });
  });
});
