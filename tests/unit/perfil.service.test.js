const bcrypt = require('bcrypt');

jest.mock('../../src/modules/perfil/perfil.repository');
jest.mock('../../src/config/passwordPolicy');
const repository = require('../../src/modules/perfil/perfil.repository');
const passwordPolicy = require('../../src/config/passwordPolicy');
const {
  obtener,
  actualizar,
  cambiarPassword,
  PerfilValidationError,
  DuplicateCorreoError,
} = require('../../src/modules/perfil/perfil.service');
const db = require('../../src/config/database');

afterAll(() => db.destroy());

describe('perfil.service.obtener (US-109 + extensión "datos de mi cuenta")', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.listPermissionsCatalog.mockResolvedValue([]);
    repository.listAreasActivas.mockResolvedValue([]);
    repository.listPermisosAsignados.mockResolvedValue([]);
    repository.findDoctorVinculado.mockResolvedValue(undefined);
    repository.findAreasDelDoctor.mockResolvedValue([]);
  });

  it('delega en el repository con el id recibido, sin doctor vinculado', async () => {
    repository.findById.mockResolvedValue({ id: 1, nombre: 'Ana', doctor_id: null });

    const result = await obtener(1);

    expect(repository.findById).toHaveBeenCalledWith(1);
    expect(repository.findDoctorVinculado).toHaveBeenCalledWith(null);
    expect(repository.findAreasDelDoctor).toHaveBeenCalledWith(null);
    expect(repository.listPermisosAsignados).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({
      id: 1,
      nombre: 'Ana',
      doctor_id: null,
      doctor: undefined,
      areasDoctor: [],
      permisosAsignadosIds: [],
    });
    expect(result.matrizPermisos).toEqual({ tabs: [] });
  });

  it('AC: incluye el doctor vinculado y sus especialidades cuando hay doctor_id', async () => {
    repository.findById.mockResolvedValue({ id: 1, nombre: 'Ana', doctor_id: 5 });
    repository.findDoctorVinculado.mockResolvedValue({
      id: 5,
      nombre: 'Carlos',
      apellidos: 'Ruiz',
    });
    repository.findAreasDelDoctor.mockResolvedValue([
      { id: 1, nombre: 'Cirugía' },
      { id: 2, nombre: 'Dermatología' },
    ]);

    const result = await obtener(1);

    expect(result.doctor).toEqual({ id: 5, nombre: 'Carlos', apellidos: 'Ruiz' });
    expect(result.areasDoctor).toEqual([
      { id: 1, nombre: 'Cirugía' },
      { id: 2, nombre: 'Dermatología' },
    ]);
  });

  it('AC: arma la matriz de permisos con los tabs fijos (Menú Principal/Agendas/Configuraciones)', async () => {
    repository.findById.mockResolvedValue({ id: 1, nombre: 'Ana', doctor_id: null });
    repository.listPermissionsCatalog.mockResolvedValue([
      { id: 10, modulo: 'doctores', accion: 'ver', codigo: 'doctores.ver' },
      { id: 11, modulo: 'doctores', accion: 'editar', codigo: 'doctores.editar' },
      { id: 12, modulo: 'areas', accion: 'ver', codigo: 'areas.ver' },
    ]);
    repository.listPermisosAsignados.mockResolvedValue([10, 12]);

    const result = await obtener(1);

    const tabConfiguraciones = result.matrizPermisos.tabs.find((t) => t.id === 'configuraciones');
    expect(tabConfiguraciones).toBeDefined();
    expect(tabConfiguraciones.acciones).toEqual(['ver', 'editar']);
    expect(result.permisosAsignadosIds).toEqual([10, 12]);
  });

  it('el tab "Agendas" solo aparece si hay áreas activas con permisos agenda_<slug> otorgables', async () => {
    repository.findById.mockResolvedValue({ id: 1, nombre: 'Ana', doctor_id: null });
    repository.listAreasActivas.mockResolvedValue([
      { id: 1, nombre: 'Dermatología', slug: 'derma' },
    ]);
    repository.listPermissionsCatalog.mockResolvedValue([
      { id: 20, modulo: 'agenda_derma', accion: 'ver', codigo: 'agenda_derma.ver' },
    ]);

    const result = await obtener(1);

    const tabAgendas = result.matrizPermisos.tabs.find((t) => t.id === 'agendas');
    expect(tabAgendas).toBeDefined();
    expect(tabAgendas.secciones[0].modulos[0]).toMatchObject({
      modulo: 'agenda_derma',
      nombre: 'Dermatología',
    });
  });
});

describe('perfil.service.actualizar (US-109)', () => {
  const base = {
    nombre: 'Ana',
    apellidos: 'Gómez',
    telefono: '55-1234-5678',
    correo: 'ana@omegavet.test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByCorreo.mockResolvedValue(undefined);
    repository.actualizar.mockResolvedValue();
    repository.findById.mockResolvedValue({ id: 7, doctor_id: null });
  });

  it('AC: actualiza nombre/apellidos/telefono/correo con valores válidos', async () => {
    const result = await actualizar(7, base);

    expect(repository.actualizar).toHaveBeenCalledWith(7, {
      ...base,
      telefono: '5512345678',
      doctorId: null,
    });
    expect(result).toEqual(base);
  });

  it('AC: si la cuenta tiene doctor vinculado, pasa su id al repository para que replique nombre/apellidos', async () => {
    repository.findById.mockResolvedValue({ id: 7, doctor_id: 42 });

    await actualizar(7, base);

    expect(repository.actualizar).toHaveBeenCalledWith(7, {
      ...base,
      telefono: '5512345678',
      doctorId: 42,
    });
  });

  it('AC: rechaza si falta Nombre', async () => {
    await expect(actualizar(7, { ...base, nombre: '' })).rejects.toBeInstanceOf(
      PerfilValidationError,
    );
    expect(repository.actualizar).not.toHaveBeenCalled();
  });

  it('AC: rechaza si falta Apellidos', async () => {
    await expect(actualizar(7, { ...base, apellidos: '  ' })).rejects.toBeInstanceOf(
      PerfilValidationError,
    );
    expect(repository.actualizar).not.toHaveBeenCalled();
  });

  it('AC: rechaza si falta Correo', async () => {
    await expect(actualizar(7, { ...base, correo: '' })).rejects.toBeInstanceOf(
      PerfilValidationError,
    );
    expect(repository.actualizar).not.toHaveBeenCalled();
  });

  it('rechaza un correo con formato inválido', async () => {
    await expect(actualizar(7, { ...base, correo: 'no-es-un-correo' })).rejects.toBeInstanceOf(
      PerfilValidationError,
    );
    expect(repository.actualizar).not.toHaveBeenCalled();
  });

  it('AC: el teléfono es opcional — vacío se guarda como null, sin rechazar', async () => {
    const result = await actualizar(7, { ...base, telefono: '' });

    expect(result.telefono).toBeNull();
    expect(repository.actualizar).toHaveBeenCalledWith(7, {
      ...base,
      telefono: null,
      doctorId: null,
    });
  });

  it('AC: rechaza un teléfono que no cumple el formato NN-NNNN-NNNN', async () => {
    await expect(actualizar(7, { ...base, telefono: '5512345678' })).rejects.toBeInstanceOf(
      PerfilValidationError,
    );
    await expect(actualizar(7, { ...base, telefono: 'abc' })).rejects.toBeInstanceOf(
      PerfilValidationError,
    );
    expect(repository.actualizar).not.toHaveBeenCalled();
  });

  it('rechaza un correo ya usado por OTRO usuario, excluyendo al propio del chequeo', async () => {
    repository.findByCorreo.mockResolvedValue({ id: 99 });

    await expect(actualizar(7, base)).rejects.toBeInstanceOf(DuplicateCorreoError);
    expect(repository.findByCorreo).toHaveBeenCalledWith(base.correo, 7);
    expect(repository.actualizar).not.toHaveBeenCalled();
  });
});

describe('perfil.service.cambiarPassword (US-110)', () => {
  const HASH_ACTUAL = bcrypt.hashSync('MiContraseñaActualLarga1', 4);
  const base = {
    passwordActual: 'MiContraseñaActualLarga1',
    passwordNueva: 'MiContraseñaNuevaLarga2',
    confirmarPassword: 'MiContraseñaNuevaLarga2',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findPasswordHash.mockResolvedValue({ password_hash: HASH_ACTUAL });
    repository.actualizarPassword.mockResolvedValue();
    passwordPolicy.assertPasswordValida.mockResolvedValue(undefined);
  });

  it.each([
    ['passwordActual', { ...base, passwordActual: '' }],
    ['passwordNueva', { ...base, passwordNueva: '' }],
    ['confirmarPassword', { ...base, confirmarPassword: '' }],
  ])('AC: rechaza si %s está vacío, sin tocar el repository', async (_campo, body) => {
    await expect(cambiarPassword(7, body)).rejects.toBeInstanceOf(PerfilValidationError);
    expect(repository.findPasswordHash).not.toHaveBeenCalled();
    expect(repository.actualizarPassword).not.toHaveBeenCalled();
  });

  it('AC: rechaza si la contraseña actual no coincide con el hash guardado, conservándolo sin cambios', async () => {
    await expect(
      cambiarPassword(7, { ...base, passwordActual: 'ContraseñaIncorrectaLarga' }),
    ).rejects.toThrow('La contraseña actual es incorrecta.');
    expect(repository.actualizarPassword).not.toHaveBeenCalled();
  });

  it('AC: rechaza si la nueva contraseña y su confirmación no coinciden', async () => {
    await expect(
      cambiarPassword(7, { ...base, confirmarPassword: 'OtraContraseñaDistintaLarga' }),
    ).rejects.toThrow('no coinciden');
    expect(repository.actualizarPassword).not.toHaveBeenCalled();
    expect(passwordPolicy.assertPasswordValida).not.toHaveBeenCalled();
  });

  it('AC: valida la nueva contraseña contra la política compartida, pasando la actual para la regla "diferente"', async () => {
    await cambiarPassword(7, base);

    expect(passwordPolicy.assertPasswordValida).toHaveBeenCalledWith(base.passwordNueva, {
      currentPassword: base.passwordActual,
    });
  });

  it('propaga el rechazo de la política compartida (longitud/lista de comunes/HIBP) sin guardar', async () => {
    const errorPolitica = new Error('La contraseña debe tener al menos 15 caracteres.');
    errorPolitica.status = 400;
    passwordPolicy.assertPasswordValida.mockRejectedValueOnce(errorPolitica);

    await expect(cambiarPassword(7, base)).rejects.toBeInstanceOf(PerfilValidationError);
    expect(repository.actualizarPassword).not.toHaveBeenCalled();
  });

  it('AC: contraseña actual correcta, nueva válida y confirmación coincide -> hashea con bcrypt y actualiza', async () => {
    await cambiarPassword(7, base);

    expect(repository.actualizarPassword).toHaveBeenCalledWith(7, expect.any(String));
    const [, hashGuardado] = repository.actualizarPassword.mock.calls[0];
    expect(await bcrypt.compare(base.passwordNueva, hashGuardado)).toBe(true);
    expect(hashGuardado).not.toBe(base.passwordNueva);
  });
});
