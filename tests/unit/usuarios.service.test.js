const bcrypt = require('bcrypt');

jest.mock('../../src/modules/usuarios/usuarios.repository');
jest.mock('../../src/config/passwordPolicy');
const repository = require('../../src/modules/usuarios/usuarios.repository');
const passwordPolicy = require('../../src/config/passwordPolicy');
const {
  list,
  obtener,
  listDoctoresDisponibles,
  resolverDoctor,
  sugerirUsername,
  obtenerCatalogoPermisos,
  permisosAsignadosDe,
  construirMatrizPermisos,
  parsePermissionIds,
  crear,
  editar,
  darDeBaja,
  resetearPassword,
  UsuarioValidationError,
  DuplicateUsernameError,
  DuplicateCorreoError,
  UltimoAdministradorPermisosError,
  NoPuedeDarDeBajaPropiaCuentaError,
  NoPuedeResetearPropiaCuentaError,
  DoctorYaVinculadoError,
} = require('../../src/modules/usuarios/usuarios.service');
const db = require('../../src/config/database');

afterAll(() => db.destroy());

describe('usuarios.service.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    repository.findPage.mockResolvedValue([]);
  });

  it('AC: por defecto el filtro es "activo" (decidido explícitamente, a diferencia de plantillas)', async () => {
    const result = await list({});
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ estatus: 'activo' }),
    );
    expect(result.estatus).toBe('activo');
  });

  it.each([['bloqueo_temp'], ['bloqueado'], ['inactivo']])(
    'acepta filtrar por estatus=%s',
    async (estatus) => {
      const result = await list({ estatus });
      expect(repository.findPage).toHaveBeenCalledWith(expect.objectContaining({ estatus }));
      expect(result.estatus).toBe(estatus);
    },
  );

  it('estatus=todos desactiva el filtro (manda undefined al repository)', async () => {
    const result = await list({ estatus: 'todos' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ estatus: undefined }),
    );
    expect(result.estatus).toBe('todos');
  });

  it('un estatus desconocido cae al default "activo", no truena', async () => {
    const result = await list({ estatus: 'lo-que-sea' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ estatus: 'activo' }),
    );
    expect(result.estatus).toBe('activo');
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
    repository.count.mockResolvedValue(5); // 5 usuarios, PAGE_SIZE=10 => 1 sola página
    const result = await list({ page: '99' });
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('catalogoVacio es true solo cuando no existe ningún usuario (sin importar filtros)', async () => {
    repository.existsAny.mockResolvedValue(false);
    const result = await list({});
    expect(result.catalogoVacio).toBe(true);
  });

  it('catalogoVacio es false si hay usuarios aunque esta búsqueda no encuentre nada', async () => {
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

  it.each([['nombre'], ['username'], ['correo'], ['estatus']])(
    'acepta ordenar por %s',
    async (column) => {
      await list({ sort: column, dir: 'desc' });
      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ sort: column, dir: 'desc' }),
      );
    },
  );

  it('una columna de orden desconocida cae a "nombre", no truena', async () => {
    const result = await list({ sort: 'algo-que-no-existe' });
    expect(result.sort).toBe('nombre');
  });

  it('una dirección desconocida cae a "asc"', async () => {
    const result = await list({ dir: 'algo-raro' });
    expect(result.dir).toBe('asc');
  });
});

describe('usuarios.service.obtener (US-602)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('incluye el doctor vinculado junto con los datos del usuario', async () => {
    repository.findById.mockResolvedValue({ id: 7, username: 'jdoe', doctor_id: 3 });
    repository.findDoctorVinculado.mockResolvedValue({
      id: 3,
      nombre: 'Ana',
      apellidos: 'Gómez',
    });

    const result = await obtener('7');

    expect(repository.findDoctorVinculado).toHaveBeenCalledWith(3);
    expect(result).toEqual({
      id: 7,
      username: 'jdoe',
      doctor_id: 3,
      doctor: { id: 3, nombre: 'Ana', apellidos: 'Gómez' },
    });
  });

  it('un id inválido no llega al repository, devuelve undefined', async () => {
    const result = await obtener('no-es-un-numero');
    expect(result).toBeUndefined();
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('un usuario inexistente devuelve undefined sin pedir su doctor', async () => {
    repository.findById.mockResolvedValue(undefined);
    const result = await obtener('7');
    expect(result).toBeUndefined();
    expect(repository.findDoctorVinculado).not.toHaveBeenCalled();
  });
});

describe('usuarios.service.listDoctoresDisponibles / resolverDoctor (US-602)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('listDoctoresDisponibles delega en el repository', async () => {
    repository.listDoctoresActivos.mockResolvedValue([
      { id: 1, nombre: 'Ana', apellidos: 'Gómez' },
    ]);
    const result = await listDoctoresDisponibles();
    expect(result).toEqual([{ id: 1, nombre: 'Ana', apellidos: 'Gómez' }]);
  });

  it('resolverDoctor busca el doctor sin filtrar por activo', async () => {
    repository.findDoctorVinculado.mockResolvedValue({ id: 3, nombre: 'Ana', apellidos: 'Gómez' });
    const result = await resolverDoctor('3');
    expect(repository.findDoctorVinculado).toHaveBeenCalledWith(3);
    expect(result).toEqual({ id: 3, nombre: 'Ana', apellidos: 'Gómez' });
  });

  it('resolverDoctor sin id no llega al repository, devuelve null', async () => {
    const result = await resolverDoctor(undefined);
    expect(result).toBeNull();
    expect(repository.findDoctorVinculado).not.toHaveBeenCalled();
  });

  it('resolverDoctor con un id inválido devuelve null sin llegar al repository', async () => {
    const result = await resolverDoctor('no-es-un-numero');
    expect(result).toBeNull();
    expect(repository.findDoctorVinculado).not.toHaveBeenCalled();
  });
});

describe('usuarios.service.construirMatrizPermisos (US-604, tabs)', () => {
  const CATALOGO_BASE = [
    { id: 1, modulo: 'tutores', accion: 'ver', codigo: 'tutores.ver' },
    { id: 2, modulo: 'tutores', accion: 'crear', codigo: 'tutores.crear' },
    { id: 3, modulo: 'tutores', accion: 'editar', codigo: 'tutores.editar' },
    { id: 4, modulo: 'tutores', accion: 'eliminar', codigo: 'tutores.eliminar' },
    { id: 5, modulo: 'metricas_whatsapp', accion: 'ver', codigo: 'metricas.whatsapp.ver' },
    { id: 6, modulo: 'laboratorio', accion: 'ver', codigo: 'laboratorio.ver' },
    { id: 7, modulo: 'laboratorio', accion: 'cargar', codigo: 'laboratorio.cargar' },
    { id: 8, modulo: 'laboratorio', accion: 'enviar', codigo: 'laboratorio.enviar' },
    { id: 9, modulo: 'usuarios', accion: 'ver', codigo: 'usuarios.ver' },
    { id: 10, modulo: 'usuarios', accion: 'editar', codigo: 'usuarios.editar' },
    { id: 11, modulo: 'usuarios', accion: 'permisos', codigo: 'usuarios.permisos' },
    {
      id: 12,
      modulo: 'usuarios',
      accion: 'resetear_password',
      codigo: 'usuarios.resetear_password',
    },
  ];

  it('AC: exactamente 3 tabs (Menú Principal/Agendas/Configuraciones), nunca un tab "Otros"', () => {
    const catalogoConAlgoSuelto = [
      ...CATALOGO_BASE,
      { id: 30, modulo: 'agenda', accion: 'ver', codigo: 'agenda.ver' }, // módulo fijo viejo, deliberadamente no expuesto
      { id: 31, modulo: 'facturacion', accion: 'ver', codigo: 'facturacion.ver' }, // módulo futuro, sin clasificar
    ];

    const { tabs } = construirMatrizPermisos(catalogoConAlgoSuelto, [
      { id: 100, nombre: 'Cardiología', slug: 'inexistente-sin-permisos' },
    ]);

    expect(tabs.map((t) => t.id)).toEqual(['principal', 'configuraciones']); // sin "agendas" (el área no matchea ningún permiso) y sin "otros"
    expect(tabs.some((t) => t.id === 'otros')).toBe(false);
  });

  it('AC: el tab "Menú Principal" ordena Tutores y pacientes, luego Laboratorio, luego Métricas — columnas Ver/Crear/Editar/Eliminar primero', () => {
    const { tabs } = construirMatrizPermisos(CATALOGO_BASE);
    const principal = tabs.find((t) => t.id === 'principal');

    expect(principal.titulo).toBe('Menú Principal');
    // ver/crear/editar/eliminar (prioritarias presentes) + carga_envio (resto)
    expect(principal.acciones).toEqual(['ver', 'crear', 'editar', 'eliminar', 'carga_envio']);
    expect(principal.secciones.map((s) => s.titulo)).toEqual([null, null, 'Métricas']);
    expect(principal.secciones[0].modulos.map((m) => m.modulo)).toEqual(['tutores']);
    expect(principal.secciones[1].modulos.map((m) => m.modulo)).toEqual(['laboratorio']);
    expect(principal.secciones[2].modulos.map((m) => m.modulo)).toEqual(['metricas_whatsapp']);
  });

  it('AC: usuarios.permisos y usuarios.resetear_password nunca aparecen como columna (van implícitos en Editar)', () => {
    const { tabs } = construirMatrizPermisos(CATALOGO_BASE);
    const configuraciones = tabs.find((t) => t.id === 'configuraciones');

    expect(configuraciones.acciones).toEqual(['ver', 'editar']);
    expect(configuraciones.acciones).not.toContain('permisos');
    expect(configuraciones.acciones).not.toContain('resetear_password');
  });

  it('laboratorio.cargar + laboratorio.enviar se combinan en un único checkbox "carga_envio" con id compuesto', () => {
    const { tabs } = construirMatrizPermisos(CATALOGO_BASE);
    const principal = tabs.find((t) => t.id === 'principal');
    const laboratorio = principal.secciones[1].modulos[0];
    const celdaCargaEnvio = laboratorio.celdas[principal.acciones.indexOf('carga_envio')];

    expect(celdaCargaEnvio).toMatchObject({ id: '7,8', accion: 'carga_envio' });
    // "ver" sigue existiendo tal cual, no se tocó
    expect(laboratorio.celdas[principal.acciones.indexOf('ver')]).toMatchObject({ id: 6 });
  });

  it('AC: cuando un módulo no tiene cierta acción, la celda es null (sin checkbox seleccionable)', () => {
    const { tabs } = construirMatrizPermisos(CATALOGO_BASE);
    const principal = tabs.find((t) => t.id === 'principal');
    const tutores = principal.secciones[0].modulos[0];

    // tutores no tiene carga_envio
    expect(tutores.celdas[principal.acciones.indexOf('carga_envio')]).toBeNull();
  });

  it('AC: el tab "Agendas" trae sus filas de la tabla `areas` (no de un catálogo fijo), emparejadas por slug', () => {
    const catalogoConAgendas = [
      ...CATALOGO_BASE,
      { id: 20, modulo: 'agenda_cardiologia', accion: 'ver', codigo: 'agenda.cardiologia.ver' },
      { id: 21, modulo: 'agenda_cardiologia', accion: 'crear', codigo: 'agenda.cardiologia.crear' },
      { id: 22, modulo: 'agenda_neurologia', accion: 'ver', codigo: 'agenda.neurologia.ver' },
    ];
    const areasActivas = [
      { id: 1, nombre: 'Cardiología', slug: 'cardiologia' },
      { id: 2, nombre: 'Un Área Sin Permisos', slug: 'sin-match' }, // no tiene agenda_sin-match.*, no debe aparecer
      { id: 3, nombre: 'Neurología', slug: 'neurologia' },
    ];

    const { tabs } = construirMatrizPermisos(catalogoConAgendas, areasActivas);
    const agendas = tabs.find((t) => t.id === 'agendas');

    expect(agendas.titulo).toBe('Agendas');
    expect(agendas.acciones).toEqual(['ver', 'crear']);
    // en el orden en que vinieron las áreas (ya ordenadas por nombre desde el repository), no el del catálogo
    expect(agendas.secciones[0].modulos).toEqual([
      expect.objectContaining({ modulo: 'agenda_cardiologia', nombre: 'Cardiología' }),
      expect.objectContaining({ modulo: 'agenda_neurologia', nombre: 'Neurología' }),
    ]);
  });

  it('sin áreas activas (o ninguna con permisos emparejados), el tab "Agendas" no aparece', () => {
    const { tabs } = construirMatrizPermisos(CATALOGO_BASE, []);
    expect(tabs.find((t) => t.id === 'agendas')).toBeUndefined();
  });

  it('un catálogo vacío y sin áreas no truena, devuelve tabs vacíos', () => {
    expect(construirMatrizPermisos([], [])).toEqual({ tabs: [] });
  });
});

describe('usuarios.service.parsePermissionIds (US-604)', () => {
  it('normaliza un único valor (string) a un array de un elemento', () => {
    expect(parsePermissionIds('5')).toEqual([5]);
  });

  it('normaliza varios valores (array) descartando duplicados', () => {
    expect(parsePermissionIds(['5', '7', '5'])).toEqual([5, 7]);
  });

  it('ausente (checkbox group sin nada marcado) devuelve un array vacío, no truena', () => {
    expect(parsePermissionIds(undefined)).toEqual([]);
  });

  it('descarta valores que no son enteros positivos', () => {
    expect(parsePermissionIds(['abc', '-3', '0', '4'])).toEqual([4]);
  });

  it('AC (Carga y Envío): un valor con dos ids separados por coma se parte en ambos', () => {
    expect(parsePermissionIds('7,8')).toEqual([7, 8]);
    expect(parsePermissionIds(['3', '7,8', '3'])).toEqual([3, 7, 8]);
  });
});

describe('usuarios.service.obtenerCatalogoPermisos / permisosAsignadosDe (US-604)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('obtenerCatalogoPermisos delega en el repository', async () => {
    repository.listPermissionsCatalog.mockResolvedValue([
      { id: 1, modulo: 'agenda', accion: 'ver' },
    ]);
    const result = await obtenerCatalogoPermisos();
    expect(result).toEqual([{ id: 1, modulo: 'agenda', accion: 'ver' }]);
  });

  it('permisosAsignadosDe con un usuarioId delega en el repository', async () => {
    repository.listPermisosUsuario.mockResolvedValue([1, 3]);
    const result = await permisosAsignadosDe(7);
    expect(repository.listPermisosUsuario).toHaveBeenCalledWith(7);
    expect(result).toEqual([1, 3]);
  });

  it('permisosAsignadosDe sin usuarioId (alta) devuelve [] sin llegar al repository', async () => {
    const result = await permisosAsignadosDe(undefined);
    expect(result).toEqual([]);
    expect(repository.listPermisosUsuario).not.toHaveBeenCalled();
  });
});

describe('usuarios.service.crear (US-602)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByUsername.mockResolvedValue(undefined);
    repository.findByCorreo.mockResolvedValue(undefined);
    repository.create.mockResolvedValue(99);
    // La política de contraseñas real (Decisión 24: longitud/lista de
    // comunes/HIBP) se prueba aparte en passwordPolicy.test.js — aquí se
    // mockea resuelta por default para que estos tests se enfoquen en las
    // reglas propias de usuarios.service.js, sin llamadas de red reales.
    passwordPolicy.assertPasswordValida.mockResolvedValue(undefined);
    // US-604 (quinta iteración): crear() ahora siempre pasa por
    // aplicarReglaVerImplicaAcciones (lee el catálogo completo) y, en el
    // camino de username duplicado, por siguienteUsernameDisponible (lee
    // findUsernamesConPrefijo) — se fijan explícitamente aquí para que
    // estos tests no dependan del estado residual que deja un mock de otro
    // describe (jest.clearAllMocks() limpia llamadas/resultados, pero NO
    // los mockResolvedValue ya configurados en otro test de este archivo).
    repository.listPermissionsCatalog.mockResolvedValue([]);
    repository.findUsernamesConPrefijo.mockResolvedValue([]);
  });

  it('crea el usuario con los campos recortados y la contraseña hasheada con bcrypt (nunca en texto plano)', async () => {
    await crear({
      nombre: '  Ana  ',
      apellidos: '  Gómez  ',
      correo: '  ana@omegavet.test  ',
      telefono: '  555-1234  ',
      username: '  ana.gomez  ',
      password: 'ContraseñaSegura1',
      doctorId: undefined,
      usuarioId: 1,
    });

    expect(repository.create).toHaveBeenCalledTimes(1);
    const args = repository.create.mock.calls[0][0];
    expect(args).toMatchObject({
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      telefono: '555-1234',
      username: 'ana.gomez',
      doctorId: null,
      usuarioId: 1,
    });
    expect(args.passwordHash).not.toBe('ContraseñaSegura1');
    expect(await bcrypt.compare('ContraseñaSegura1', args.passwordHash)).toBe(true);
  });

  it('un teléfono vacío se guarda como null, no como cadena vacía', async () => {
    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      telefono: '   ',
      username: 'ana.gomez',
      password: 'ContraseñaSegura1',
      usuarioId: 1,
    });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ telefono: null }));
  });

  it('AC: guarda el doctorId cuando se selecciona uno del listbox', async () => {
    repository.findByDoctorId.mockResolvedValue(undefined);
    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      password: 'ContraseñaSegura1',
      doctorId: '5',
      usuarioId: 1,
    });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ doctorId: 5 }));
    expect(repository.findByDoctorId).toHaveBeenCalledWith(5);
  });

  it('AC (octava iteración): rechaza un doctorId ya vinculado a otro usuario, sin crear el registro', async () => {
    repository.findByDoctorId.mockResolvedValue({ id: 9 });
    await expect(
      crear({
        nombre: 'Ana',
        apellidos: 'Gómez',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        password: 'ContraseñaSegura1',
        doctorId: '5',
        usuarioId: 1,
      }),
    ).rejects.toThrow(DoctorYaVinculadoError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('sin doctorId, no se consulta findByDoctorId (nada que proteger)', async () => {
    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      password: 'ContraseñaSegura1',
      usuarioId: 1,
    });
    expect(repository.findByDoctorId).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ doctorId: null }));
  });

  it('US-604 AC: guarda un permission_id en usuario_permisos por cada permiso seleccionado', async () => {
    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      password: 'ContraseñaSegura1',
      permisos: ['2', '4'],
      usuarioId: 1,
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ permissionIds: [2, 4] }),
    );
  });

  it('US-604: sin ningún permiso marcado, manda un array vacío (no crea relaciones)', async () => {
    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      password: 'ContraseñaSegura1',
      usuarioId: 1,
    });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ permissionIds: [] }));
  });

  it('AC (segunda iteración): marcar usuarios.editar en el alta agrega automáticamente usuarios.permisos y usuarios.resetear_password', async () => {
    repository.findPermissionIdByCodigo.mockImplementation(async (codigo) => {
      if (codigo === 'usuarios.editar') return 50;
      if (codigo === 'usuarios.permisos') return 51;
      if (codigo === 'usuarios.resetear_password') return 52;
      return null;
    });

    await crear({
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      password: 'ContraseñaSegura1',
      permisos: ['50'],
      usuarioId: 1,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ permissionIds: expect.arrayContaining([50, 51, 52]) }),
    );
  });

  it('rechaza un nombre vacío sin llegar al repository', async () => {
    await expect(
      crear({
        nombre: '   ',
        apellidos: 'Gómez',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        password: 'ContraseñaSegura1',
        usuarioId: 1,
      }),
    ).rejects.toThrow(UsuarioValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('AC: rechaza una contraseña que no cumple la política compartida (Decisión 24), relanzada como UsuarioValidationError', async () => {
    const errorPolitica = new Error('La contraseña debe tener al menos 15 caracteres.');
    errorPolitica.status = 400;
    passwordPolicy.assertPasswordValida.mockRejectedValueOnce(errorPolitica);

    await expect(
      crear({
        nombre: 'Ana',
        apellidos: 'Gómez',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        password: 'corta',
        usuarioId: 1,
      }),
    ).rejects.toThrow(UsuarioValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('AC: rechaza un username ya usado por cualquier otro registro, sin importar su estatus', async () => {
    repository.findByUsername.mockResolvedValue({ id: 7, estatus: 'inactivo' });
    await expect(
      crear({
        nombre: 'Ana',
        apellidos: 'Gómez',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        password: 'ContraseñaSegura1',
        usuarioId: 1,
      }),
    ).rejects.toThrow(DuplicateUsernameError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('AC: rechaza un correo ya usado por cualquier otro registro, sin importar su estatus', async () => {
    repository.findByCorreo.mockResolvedValue({ id: 7, estatus: 'bloqueado' });
    await expect(
      crear({
        nombre: 'Ana',
        apellidos: 'Gómez',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        password: 'ContraseñaSegura1',
        usuarioId: 1,
      }),
    ).rejects.toThrow(DuplicateCorreoError);
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('usuarios.service.editar (US-602)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByUsername.mockResolvedValue(undefined);
    repository.findByCorreo.mockResolvedValue(undefined);
    repository.update.mockResolvedValue();
    repository.listPermissionsCatalog.mockResolvedValue([]);
    repository.findUsernamesConPrefijo.mockResolvedValue([]);
  });

  it('actualiza los datos generales y el estatus, sin tocar la contraseña', async () => {
    await editar({
      id: 5,
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      telefono: '555-1234',
      username: 'ana.gomez',
      estatus: 'activo',
      usuarioId: 2,
    });

    expect(repository.update).toHaveBeenCalledWith(5, {
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      telefono: '555-1234',
      username: 'ana.gomez',
      estatus: 'activo',
      permissionIds: undefined,
      usuarioId: 2,
    });
    expect(repository.update.mock.calls[0][1]).not.toHaveProperty('password');
    expect(repository.update.mock.calls[0][1]).not.toHaveProperty('passwordHash');
  });

  it('excluye el propio id al chequear duplicados de username/correo', async () => {
    await editar({
      id: 5,
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      estatus: 'activo',
      usuarioId: 2,
    });
    expect(repository.findByUsername).toHaveBeenCalledWith('ana.gomez', 5);
    expect(repository.findByCorreo).toHaveBeenCalledWith('ana@omegavet.test', 5);
  });

  it('rechaza un username ya usado por otro registro', async () => {
    repository.findByUsername.mockResolvedValue({ id: 7 });
    await expect(
      editar({
        id: 5,
        nombre: 'Ana',
        apellidos: 'Gómez',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        estatus: 'activo',
        usuarioId: 2,
      }),
    ).rejects.toThrow(DuplicateUsernameError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rechaza un correo ya usado por otro registro', async () => {
    repository.findByCorreo.mockResolvedValue({ id: 7 });
    await expect(
      editar({
        id: 5,
        nombre: 'Ana',
        apellidos: 'Gómez',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        estatus: 'activo',
        usuarioId: 2,
      }),
    ).rejects.toThrow(DuplicateCorreoError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('un estatus desconocido cae a "activo", no truena', async () => {
    await editar({
      id: 5,
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      estatus: 'lo-que-sea',
      usuarioId: 2,
    });
    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ estatus: 'activo' }),
    );
  });

  it('AC (octava iteración): el vínculo con un doctor NUNCA se toca desde edición, aunque llegue un doctorId en el body', async () => {
    await editar({
      id: 5,
      nombre: 'Ana',
      apellidos: 'Gómez',
      correo: 'ana@omegavet.test',
      username: 'ana.gomez',
      doctorId: '99', // un intento directo/forjado — editar() ya ni acepta este parámetro
      estatus: 'activo',
      usuarioId: 2,
    });
    expect(repository.update.mock.calls[0][1]).not.toHaveProperty('doctorId');
  });

  it('rechaza apellidos vacíos', async () => {
    await expect(
      editar({
        id: 5,
        nombre: 'Ana',
        apellidos: '',
        correo: 'ana@omegavet.test',
        username: 'ana.gomez',
        estatus: 'activo',
        usuarioId: 2,
      }),
    ).rejects.toThrow(UsuarioValidationError);
  });
});

describe('usuarios.service.editar — permisos (US-604)', () => {
  const PERMISO_ADMIN_ID = 99;
  const PERMISO_EDITAR_ID = 50;
  const PERMISO_RESET_ID = 51;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByUsername.mockResolvedValue(undefined);
    repository.findByCorreo.mockResolvedValue(undefined);
    repository.update.mockResolvedValue();
    repository.findPermissionIdByCodigo.mockImplementation(async (codigo) => {
      if (codigo === 'usuarios.permisos') return PERMISO_ADMIN_ID;
      if (codigo === 'usuarios.editar') return PERMISO_EDITAR_ID;
      if (codigo === 'usuarios.resetear_password') return PERMISO_RESET_ID;
      return null;
    });
    repository.listPermisosUsuario.mockResolvedValue([]);
    repository.countUsuariosActivosConPermiso.mockResolvedValue(1);
    repository.listPermissionsCatalog.mockResolvedValue([]);
  });

  const base = {
    id: 5,
    nombre: 'Ana',
    apellidos: 'Gómez',
    correo: 'ana@omegavet.test',
    username: 'ana.gomez',
    estatus: 'activo',
    usuarioId: 2,
  };

  it('permisosProvistos=false (sin usuarios.permisos): no toca usuario_permisos ni valida nada', async () => {
    await editar({ ...base, permisos: ['1'], permisosProvistos: false });

    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ permissionIds: undefined }),
    );
    expect(repository.listPermisosUsuario).not.toHaveBeenCalled();
    expect(repository.countUsuariosActivosConPermiso).not.toHaveBeenCalled();
  });

  it('permisosProvistos=true: parsea y manda los permissionIds seleccionados al repository', async () => {
    await editar({ ...base, permisos: ['1', '3'], permisosProvistos: true });

    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ permissionIds: [1, 3] }),
    );
  });

  it('AC: retirar usuarios.permisos cuando NO queda ningún otro usuario activo con ese permiso se rechaza', async () => {
    repository.listPermisosUsuario.mockResolvedValue([PERMISO_ADMIN_ID, 1]);
    repository.countUsuariosActivosConPermiso.mockResolvedValue(0);

    await expect(
      editar({ ...base, permisos: ['1'], permisosProvistos: true }), // ya no incluye PERMISO_ADMIN_ID
    ).rejects.toThrow(UltimoAdministradorPermisosError);

    expect(repository.countUsuariosActivosConPermiso).toHaveBeenCalledWith(PERMISO_ADMIN_ID, 5);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('retirar usuarios.permisos cuando SÍ existe otro usuario activo con ese permiso se permite', async () => {
    repository.listPermisosUsuario.mockResolvedValue([PERMISO_ADMIN_ID, 1]);
    repository.countUsuariosActivosConPermiso.mockResolvedValue(1);

    await editar({ ...base, permisos: ['1'], permisosProvistos: true });

    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ permissionIds: [1] }),
    );
  });

  it('dejar usuarios.permisos marcado (ya lo tenía) no dispara la validación de último administrador', async () => {
    repository.listPermisosUsuario.mockResolvedValue([PERMISO_ADMIN_ID]);

    await editar({
      ...base,
      permisos: [String(PERMISO_ADMIN_ID)],
      permisosProvistos: true,
    });

    expect(repository.countUsuariosActivosConPermiso).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalled();
  });

  it('no tenía usuarios.permisos antes: agregarlo o dejarlo desmarcado no valida nada', async () => {
    repository.listPermisosUsuario.mockResolvedValue([1]); // no incluye PERMISO_ADMIN_ID

    await editar({ ...base, permisos: ['1'], permisosProvistos: true });

    expect(repository.countUsuariosActivosConPermiso).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalled();
  });

  it('catálogo sin el código usuarios.permisos: no valida (nada que proteger)', async () => {
    repository.findPermissionIdByCodigo.mockResolvedValue(null);

    await editar({ ...base, permisos: [], permisosProvistos: true });

    expect(repository.listPermisosUsuario).not.toHaveBeenCalled();
    expect(repository.countUsuariosActivosConPermiso).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalled();
  });

  it('AC (segunda iteración): marcar usuarios.editar agrega automáticamente usuarios.permisos y usuarios.resetear_password', async () => {
    await editar({
      ...base,
      permisos: ['1', String(PERMISO_EDITAR_ID)],
      permisosProvistos: true,
    });

    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        permissionIds: expect.arrayContaining([
          1,
          PERMISO_EDITAR_ID,
          PERMISO_ADMIN_ID,
          PERMISO_RESET_ID,
        ]),
      }),
    );
  });

  it('sin usuarios.editar marcado, no se agrega usuarios.permisos ni usuarios.resetear_password', async () => {
    await editar({ ...base, permisos: ['1'], permisosProvistos: true });

    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ permissionIds: [1] }),
    );
  });

  it('desmarcar usuarios.editar (aunque ya tuviera usuarios.permisos) lo retira junto con resetear_password, vía el diff normal', async () => {
    repository.listPermisosUsuario.mockResolvedValue([
      PERMISO_EDITAR_ID,
      PERMISO_ADMIN_ID,
      PERMISO_RESET_ID,
    ]);
    repository.countUsuariosActivosConPermiso.mockResolvedValue(1); // hay otro admin activo

    await editar({ ...base, permisos: [], permisosProvistos: true }); // editar ya no viene marcado

    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ permissionIds: [] }),
    );
  });
});

describe('usuarios.service — validación de formato de correo (US-604, sexta iteración)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByUsername.mockResolvedValue(undefined);
    repository.findByCorreo.mockResolvedValue(undefined);
    repository.create.mockResolvedValue(99);
    repository.update.mockResolvedValue();
    repository.listPermissionsCatalog.mockResolvedValue([]);
    repository.findUsernamesConPrefijo.mockResolvedValue([]);
    passwordPolicy.assertPasswordValida.mockResolvedValue(undefined);
  });

  const base = {
    nombre: 'Ana',
    apellidos: 'Gómez',
    username: 'ana.gomez',
    password: 'ContraseñaSegura1',
    usuarioId: 1,
  };

  it.each([
    ['sin arroba', 'anaomegavet.test'],
    ['sin dominio', 'ana@'],
    ['sin TLD', 'ana@omegavet'],
    ['con espacios', 'ana @omegavet.test'],
    ['vacío', ''],
  ])('crear() rechaza un correo %s', async (_desc, correo) => {
    await expect(crear({ ...base, correo })).rejects.toThrow(UsuarioValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('crear() acepta un correo con formato válido', async () => {
    await crear({ ...base, correo: 'ana.gomez@omegavet.test' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ correo: 'ana.gomez@omegavet.test' }),
    );
  });

  it('editar() rechaza un correo sin formato válido', async () => {
    await expect(
      editar({ id: 5, ...base, correo: 'ana-arroba-omegavet.test', estatus: 'activo' }),
    ).rejects.toThrow(UsuarioValidationError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('editar() acepta un correo con formato válido', async () => {
    await editar({ id: 5, ...base, correo: 'ana@omegavet.test', estatus: 'activo' });
    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ correo: 'ana@omegavet.test' }),
    );
  });
});

describe('usuarios.service — regla "Ver implica las demás acciones" (US-604, sexta iteración)', () => {
  // catálogo mínimo con dos módulos independientes, cada uno con su propio
  // "ver" — para comprobar que la regla actúa por módulo, no globalmente.
  const CATALOGO = [
    { id: 1, modulo: 'tutores', accion: 'ver' },
    { id: 2, modulo: 'tutores', accion: 'crear' },
    { id: 3, modulo: 'tutores', accion: 'editar' },
    { id: 4, modulo: 'laboratorio', accion: 'ver' },
    { id: 5, modulo: 'laboratorio', accion: 'cargar' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByUsername.mockResolvedValue(undefined);
    repository.findByCorreo.mockResolvedValue(undefined);
    repository.create.mockResolvedValue(99);
    repository.update.mockResolvedValue();
    repository.listPermissionsCatalog.mockResolvedValue(CATALOGO);
    repository.findUsernamesConPrefijo.mockResolvedValue([]);
    passwordPolicy.assertPasswordValida.mockResolvedValue(undefined);
  });

  const base = {
    nombre: 'Ana',
    apellidos: 'Gómez',
    correo: 'ana@omegavet.test',
    username: 'ana.gomez',
    password: 'ContraseñaSegura1',
    usuarioId: 1,
  };

  it('AC: marcar "crear" sin "ver" agrega "ver" del mismo módulo automáticamente (defensa en el servidor)', async () => {
    await crear({ ...base, permisos: ['2'] }); // tutores.crear, sin tutores.ver
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ permissionIds: expect.arrayContaining([1, 2]) }),
    );
  });

  it('no duplica "ver" si ya venía marcado explícitamente', async () => {
    await crear({ ...base, permisos: ['1', '2'] });
    const { permissionIds } = repository.create.mock.calls[0][0];
    expect(permissionIds.filter((id) => id === 1)).toHaveLength(1);
  });

  it('un módulo sin ninguna acción marcada no agrega su "ver" (nada que implicar)', async () => {
    await crear({ ...base, permisos: [] });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ permissionIds: [] }));
  });

  it('actúa de forma independiente por módulo: marcar laboratorio.cargar no agrega tutores.ver', async () => {
    await crear({ ...base, permisos: ['5'] }); // laboratorio.cargar
    const { permissionIds } = repository.create.mock.calls[0][0];
    expect(permissionIds).toEqual(expect.arrayContaining([4, 5])); // agrega laboratorio.ver (4)
    expect(permissionIds).not.toContain(1); // pero no tutores.ver
  });

  it('AC: nunca QUITA una acción ya seleccionada aunque "ver" esté ausente (solo agrega, es de una sola dirección)', async () => {
    await crear({ ...base, permisos: ['2', '3'] }); // tutores.crear + tutores.editar, sin ver
    const { permissionIds } = repository.create.mock.calls[0][0];
    expect(permissionIds).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('también aplica en editar() cuando permisosProvistos=true', async () => {
    await editar({ id: 5, ...base, permisos: ['2'], permisosProvistos: true, estatus: 'activo' });
    expect(repository.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ permissionIds: expect.arrayContaining([1, 2]) }),
    );
  });
});

describe('usuarios.service.sugerirUsername (US-604, sexta iteración)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findUsernamesConPrefijo.mockResolvedValue([]);
  });

  it.each([
    ['José Juan', 'Tomillo Murcia', 'jose.tomillo'],
    ['Pedro', 'Marcial Marinero', 'pedro.marcial'],
    ['Juan Miguel', 'Sánchez Briseño', 'juan.sanchez'],
    ['María Fernanda', 'Muñoz López', 'maria.munoz'],
  ])(
    'AC: %s / %s -> %s (primer nombre + primer apellido, sin acentos, en minúsculas)',
    async (nombre, apellidos, esperado) => {
      const result = await sugerirUsername(nombre, apellidos);
      expect(result).toBe(esperado);
      expect(repository.findUsernamesConPrefijo).toHaveBeenCalledWith(esperado, undefined);
    },
  );

  it('sin nombre o sin apellidos devuelve cadena vacía sin llegar al repository', async () => {
    expect(await sugerirUsername('', 'Gómez')).toBe('');
    expect(await sugerirUsername('Ana', '')).toBe('');
    expect(await sugerirUsername(undefined, undefined)).toBe('');
    expect(repository.findUsernamesConPrefijo).not.toHaveBeenCalled();
  });

  it('el prefijo base se usa tal cual cuando todavía no existe ningún username con ese prefijo', async () => {
    repository.findUsernamesConPrefijo.mockResolvedValue([]);
    expect(await sugerirUsername('Juan', 'Sánchez')).toBe('juan.sanchez');
  });

  it('AC: si el prefijo ya existe, propone el siguiente consecutivo (mayor sufijo existente + 1)', async () => {
    repository.findUsernamesConPrefijo.mockResolvedValue(['juan.sanchez', 'juan.sanchez.2']);
    expect(await sugerirUsername('Juan', 'Sánchez')).toBe('juan.sanchez.3');
  });

  it('AC exacto del enunciado: juan.sanchez + .2 + .4 existentes -> .5 (nunca el primer hueco libre .3)', async () => {
    repository.findUsernamesConPrefijo.mockResolvedValue([
      'juan.sanchez',
      'juan.sanchez.2',
      'juan.sanchez.4',
    ]);
    expect(await sugerirUsername('Juan', 'Sánchez')).toBe('juan.sanchez.5');
  });

  it('pasa excludeId al repository (modo edición: no chocar contra el propio username actual)', async () => {
    await sugerirUsername('Ana', 'Gómez', '5');
    expect(repository.findUsernamesConPrefijo).toHaveBeenCalledWith('ana.gomez', 5);
  });
});

describe('usuarios.service — DuplicateUsernameError con sugerencia automática (US-604, sexta iteración)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByCorreo.mockResolvedValue(undefined);
    repository.create.mockResolvedValue(99);
    repository.update.mockResolvedValue();
    repository.listPermissionsCatalog.mockResolvedValue([]);
    passwordPolicy.assertPasswordValida.mockResolvedValue(undefined);
  });

  const base = {
    nombre: 'Ana',
    apellidos: 'Gómez',
    correo: 'ana@omegavet.test',
    username: 'ana.gomez',
    password: 'ContraseñaSegura1',
    usuarioId: 1,
  };

  it('AC: crear() con username ya tomado calcula el siguiente consecutivo y lo expone como usernameSugerido', async () => {
    repository.findByUsername.mockResolvedValue({ id: 7 });
    repository.findUsernamesConPrefijo.mockResolvedValue(['ana.gomez']);

    const error = await crear(base).catch((e) => e);

    expect(error).toBeInstanceOf(DuplicateUsernameError);
    expect(error.status).toBe(409);
    expect(error.usernameSugerido).toBe('ana.gomez.2');
    expect(error.message).toContain('ana.gomez.2');
  });

  it('editar() con username tomado por otro registro también recalcula el consecutivo, excluyendo el propio id', async () => {
    repository.findByUsername.mockResolvedValue({ id: 7 });
    repository.findUsernamesConPrefijo.mockResolvedValue(['ana.gomez', 'ana.gomez.2']);

    const error = await editar({ id: 5, ...base, estatus: 'activo' }).catch((e) => e);

    expect(error).toBeInstanceOf(DuplicateUsernameError);
    expect(error.usernameSugerido).toBe('ana.gomez.3');
    expect(repository.findUsernamesConPrefijo).toHaveBeenCalledWith('ana.gomez', 5);
  });
});

describe('usuarios.service.darDeBaja (US-603)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.darDeBaja.mockResolvedValue();
  });

  it('delega en el repository con el id del usuario objetivo y el id de quien ejecuta la baja', async () => {
    await darDeBaja('7', 2);
    expect(repository.darDeBaja).toHaveBeenCalledWith(7, 2);
  });

  it('AC: rechaza dar de baja la propia cuenta, sin llegar al repository', async () => {
    await expect(darDeBaja('2', 2)).rejects.toThrow(NoPuedeDarDeBajaPropiaCuentaError);
    expect(repository.darDeBaja).not.toHaveBeenCalled();
  });

  it('un id inválido no llega al repository, no truena', async () => {
    await darDeBaja('no-es-un-numero', 2);
    expect(repository.darDeBaja).not.toHaveBeenCalled();
  });

  // La idempotencia ("usuario ya inactivo, no vuelve a ejecutar la
  // operación") y la invalidación de sesión son responsabilidad de la query
  // atómica de usuarios.repository.js#darDeBaja (WHERE real contra
  // Postgres) — probadas en integración, no aquí.
});

describe('usuarios.service.resetearPassword (US-605)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('genera una temporal de 16 caracteres (Decisión 24: mínimo 15), la hashea con bcrypt y la devuelve en texto plano si el repository afectó una fila', async () => {
    repository.resetearPassword.mockResolvedValue(1);

    const passwordTemporal = await resetearPassword('7', 2);

    expect(passwordTemporal).toHaveLength(16);
    // AC: "sin permitir que el usuario administrador capture o defina
    // manualmente dicha contraseña" — no hay ningún parámetro de entrada
    // que pudiera influir en el valor generado, solo el id objetivo y
    // quién ejecuta la operación.
    expect(repository.resetearPassword).toHaveBeenCalledTimes(1);
    const [idLlamado, hashGuardado, usuarioIdLlamado] = repository.resetearPassword.mock.calls[0];
    expect(idLlamado).toBe(7);
    expect(usuarioIdLlamado).toBe(2);
    expect(await bcrypt.compare(passwordTemporal, hashGuardado)).toBe(true);
  });

  it('el alfabeto de la temporal nunca incluye caracteres ambiguos (0/O, 1/l/I)', async () => {
    repository.resetearPassword.mockResolvedValue(1);

    // Se generan varias para reducir la probabilidad de un falso negativo
    // por no haber tocado el caracter problemático en una sola corrida.
    const generadas = await Promise.all(Array.from({ length: 30 }, () => resetearPassword('7', 2)));

    generadas.forEach((passwordTemporal) => {
      expect(passwordTemporal).not.toMatch(/[0O1lI]/);
    });
  });

  it('devuelve null (sin exponer ninguna contraseña) si el repository no afectó ninguna fila (id inexistente)', async () => {
    repository.resetearPassword.mockResolvedValue(0);

    const passwordTemporal = await resetearPassword('999999', 2);

    expect(passwordTemporal).toBeNull();
  });

  it('AC (mismo criterio que darDeBaja): rechaza resetear la propia contraseña, sin llegar al repository', async () => {
    await expect(resetearPassword('2', 2)).rejects.toThrow(NoPuedeResetearPropiaCuentaError);
    expect(repository.resetearPassword).not.toHaveBeenCalled();
  });

  it('un id inválido no llega al repository, devuelve null sin tronar', async () => {
    const passwordTemporal = await resetearPassword('no-es-un-numero', 2);

    expect(passwordTemporal).toBeNull();
    expect(repository.resetearPassword).not.toHaveBeenCalled();
  });

  // AC9 (conservar 'inactivo') y la invalidación de sesión son
  // responsabilidad de la transacción de usuarios.repository.js#resetearPassword
  // (lee el estatus actual dentro de la misma transacción) — probadas en
  // integración, no aquí.
});
