const bcrypt = require('bcrypt');

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/config/passwordPolicy');
const repository = require('../../src/modules/auth/auth.repository');
const passwordPolicy = require('../../src/config/passwordPolicy');
const {
  login,
  cambiarPasswordObligatorio,
  InvalidCredentialsError,
  AccountLockedError,
  TemporaryLockError,
  PasswordInvalidaError,
} = require('../../src/modules/auth/auth.service');
// El automock de Jest carga igual el módulo real del repository para
// inspeccionar su forma, lo que a su vez crea un pool de Knex real
// (config/database.js) aunque nunca se use: se cierra al terminar.
const db = require('../../src/config/database');

afterAll(() => db.destroy());

describe('auth.service.login', () => {
  const PASSWORD = 'CorrectHorseBattery1!';
  const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4); // costo bajo: solo son pruebas

  function makeUser(overrides = {}) {
    return {
      id: 1,
      username: 'jdoe',
      password_hash: PASSWORD_HASH,
      estatus: 'activo',
      intentos_fallidos: 0,
      bloqueado_en: null,
      nombre: 'Jane',
      apellidos: 'Doe',
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC3: credenciales correctas + cuenta activa -> resuelve permisos, resetea el contador y actualiza último login', async () => {
    repository.findByUsername.mockResolvedValue(makeUser());
    repository.getPermissionCodes.mockResolvedValue(['agenda.ver', 'laboratorio.ver']);
    repository.resetIntentosYLogin.mockResolvedValue();

    const result = await login('jdoe', PASSWORD);

    expect(result).toEqual({
      id: 1,
      username: 'jdoe',
      nombre: 'Jane',
      apellidos: 'Doe',
      permissions: ['agenda.ver', 'laboratorio.ver'],
    });
    expect(repository.resetIntentosYLogin).toHaveBeenCalledWith(1);
  });

  it('AC4: usuario inexistente -> InvalidCredentialsError (mensaje genérico)', async () => {
    repository.findByUsername.mockResolvedValue(undefined);

    await expect(login('no-existe', PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(repository.getPermissionCodes).not.toHaveBeenCalled();
  });

  it('AC4: contraseña incorrecta -> InvalidCredentialsError, mismo tipo que usuario inexistente, y registra el intento', async () => {
    repository.findByUsername.mockResolvedValue(makeUser({ intentos_fallidos: 2 }));
    repository.registrarIntentoFallido.mockResolvedValue();

    await expect(login('jdoe', 'contraseña-incorrecta')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(repository.registrarIntentoFallido).toHaveBeenCalledWith(1, 2);
  });

  it('AC4: el mensaje es idéntico exista o no el usuario (no revela existencia)', async () => {
    repository.findByUsername.mockResolvedValueOnce(undefined);
    let mensajeUsuarioInexistente;
    try {
      await login('no-existe', PASSWORD);
    } catch (err) {
      mensajeUsuarioInexistente = err.message;
    }

    repository.findByUsername.mockResolvedValueOnce(makeUser());
    repository.registrarIntentoFallido.mockResolvedValue();
    let mensajeContrasenaIncorrecta;
    try {
      await login('jdoe', 'otra-cosa');
    } catch (err) {
      mensajeContrasenaIncorrecta = err.message;
    }

    expect(mensajeUsuarioInexistente).toBe(mensajeContrasenaIncorrecta);
  });

  it('US-106 PASO 1: cuenta inactiva (dada de baja) -> InvalidCredentialsError, mismo mensaje genérico, sin registrar intento', async () => {
    repository.findByUsername.mockResolvedValue(makeUser({ estatus: 'inactivo' }));

    await expect(login('jdoe', PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(repository.registrarIntentoFallido).not.toHaveBeenCalled();
    expect(repository.resetIntentosYLogin).not.toHaveBeenCalled();
  });

  it('US-106 PASO 1: cuenta inactiva + contraseña incorrecta -> sigue siendo el mismo error genérico (no revela que existe)', async () => {
    repository.findByUsername.mockResolvedValue(makeUser({ estatus: 'inactivo' }));

    await expect(login('jdoe', 'otra-cosa')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('US-106 PASO 1: cuenta bloqueada permanentemente -> AccountLockedError, sin evaluar contraseña ni registrar intento', async () => {
    repository.findByUsername.mockResolvedValue(
      makeUser({ estatus: 'bloqueado', intentos_fallidos: 15 }),
    );

    await expect(login('jdoe', PASSWORD)).rejects.toBeInstanceOf(AccountLockedError);
    expect(repository.registrarIntentoFallido).not.toHaveBeenCalled();
  });

  it('US-106 PASO 1: bloqueada permanentemente rechaza incluso con la contraseña CORRECTA', async () => {
    repository.findByUsername.mockResolvedValue(
      makeUser({ estatus: 'bloqueado', intentos_fallidos: 15 }),
    );

    await expect(login('jdoe', PASSWORD)).rejects.toBeInstanceOf(AccountLockedError);
    expect(repository.resetIntentosYLogin).not.toHaveBeenCalled();
  });

  it('US-106 PASO 2/3: bloqueo temporal (5 intentos) vigente -> TemporaryLockError con los minutos restantes, sin registrar el intento', async () => {
    const bloqueadoEn = new Date(Date.now() - 5 * 60_000); // hace 5 min, de 15
    repository.findByUsername.mockResolvedValue(
      makeUser({ estatus: 'bloqueo_temp', intentos_fallidos: 5, bloqueado_en: bloqueadoEn }),
    );

    const error = await login('jdoe', PASSWORD).catch((err) => err);

    expect(error).toBeInstanceOf(TemporaryLockError);
    expect(error.message).toMatch(/1[0-5] minutos/); // ~10 min restantes de 15
    expect(repository.registrarIntentoFallido).not.toHaveBeenCalled();
    expect(repository.resetIntentosYLogin).not.toHaveBeenCalled();
  });

  it('US-106 PASO 2/3: bloqueo temporal (10 intentos) usa la duración de 30 min, no 15', async () => {
    const bloqueadoEn = new Date(Date.now() - 5 * 60_000);
    repository.findByUsername.mockResolvedValue(
      makeUser({ estatus: 'bloqueo_temp', intentos_fallidos: 10, bloqueado_en: bloqueadoEn }),
    );

    const error = await login('jdoe', PASSWORD).catch((err) => err);

    expect(error).toBeInstanceOf(TemporaryLockError);
    expect(error.message).toMatch(/2[0-5] minutos/); // ~25 min restantes de 30
  });

  it('US-106 PASO 2: bloqueo temporal YA EXPIRADO permite evaluar la contraseña (login exitoso)', async () => {
    const bloqueadoEn = new Date(Date.now() - 16 * 60_000); // pasaron los 15 min
    repository.findByUsername.mockResolvedValue(
      makeUser({ estatus: 'bloqueo_temp', intentos_fallidos: 5, bloqueado_en: bloqueadoEn }),
    );
    repository.getPermissionCodes.mockResolvedValue([]);
    repository.resetIntentosYLogin.mockResolvedValue();

    const result = await login('jdoe', PASSWORD);

    expect(result.id).toBe(1);
    expect(repository.resetIntentosYLogin).toHaveBeenCalledWith(1);
  });

  it('US-106 PASO 2: bloqueo temporal YA EXPIRADO + contraseña incorrecta -> registra el intento (no se pierde el AC de conservar el acumulado)', async () => {
    const bloqueadoEn = new Date(Date.now() - 16 * 60_000);
    repository.findByUsername.mockResolvedValue(
      makeUser({ estatus: 'bloqueo_temp', intentos_fallidos: 5, bloqueado_en: bloqueadoEn }),
    );
    repository.registrarIntentoFallido.mockResolvedValue();

    await expect(login('jdoe', 'otra-cosa')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(repository.registrarIntentoFallido).toHaveBeenCalledWith(1, 5);
  });

  describe('US-605: estatus=cambio_pwd (login con contraseña temporal)', () => {
    it('temporal correcta -> sesión restringida (mustChangePassword:true, permissions:[]), sin llamar getPermissionCodes ni resetIntentosYLogin', async () => {
      repository.findByUsername.mockResolvedValue(makeUser({ estatus: 'cambio_pwd' }));
      repository.resetIntentosCambioPwd.mockResolvedValue();

      const result = await login('jdoe', PASSWORD);

      expect(result).toEqual({
        id: 1,
        username: 'jdoe',
        nombre: 'Jane',
        apellidos: 'Doe',
        permissions: [],
        mustChangePassword: true,
      });
      expect(repository.resetIntentosCambioPwd).toHaveBeenCalledWith(1);
      expect(repository.getPermissionCodes).not.toHaveBeenCalled();
      expect(repository.resetIntentosYLogin).not.toHaveBeenCalled();
    });

    it('temporal incorrecta -> InvalidCredentialsError, usa el contador PROPIO de cambio_pwd, no el de US-106', async () => {
      repository.findByUsername.mockResolvedValue(
        makeUser({ estatus: 'cambio_pwd', intentos_fallidos: 2 }),
      );
      repository.registrarIntentoFallidoCambioPwd.mockResolvedValue();

      await expect(login('jdoe', 'otra-cosa')).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(repository.registrarIntentoFallidoCambioPwd).toHaveBeenCalledWith(1, 2);
      expect(repository.registrarIntentoFallido).not.toHaveBeenCalled();
    });
  });

  describe('US-605: cambiarPasswordObligatorio', () => {
    beforeEach(() => {
      // La política real (Decisión 24) se prueba aparte en
      // passwordPolicy.test.js — aquí se mockea resuelta por default,
      // salvo el test que verifica explícitamente el rechazo.
      passwordPolicy.assertPasswordValida.mockResolvedValue(undefined);
    });

    it('AC18: contraseña válida y coincide con la confirmación -> hashea, delega en el repository y devuelve los permisos reales', async () => {
      repository.completarCambioPassword.mockResolvedValue();
      repository.getPermissionCodes.mockResolvedValue(['usuarios.ver']);

      const permissions = await cambiarPasswordObligatorio(
        1,
        'NuevaClaveLargaSegura123!',
        'NuevaClaveLargaSegura123!',
      );

      expect(permissions).toEqual(['usuarios.ver']);
      expect(repository.completarCambioPassword).toHaveBeenCalledWith(1, expect.any(String));
      const [, hashGuardado] = repository.completarCambioPassword.mock.calls[0];
      expect(await bcrypt.compare('NuevaClaveLargaSegura123!', hashGuardado)).toBe(true);
    });

    it('AC: no llama a assertPasswordValida con currentPassword — "diferente a la actual" no aplica al cambio obligatorio', async () => {
      repository.completarCambioPassword.mockResolvedValue();
      repository.getPermissionCodes.mockResolvedValue([]);

      await cambiarPasswordObligatorio(1, 'NuevaClaveLargaSegura123!', 'NuevaClaveLargaSegura123!');

      expect(passwordPolicy.assertPasswordValida).toHaveBeenCalledWith('NuevaClaveLargaSegura123!');
    });

    it('rechaza una contraseña que no cumple la política compartida (Decisión 24), sin tocar el repository', async () => {
      const errorPolitica = new Error('La contraseña debe tener al menos 15 caracteres.');
      errorPolitica.status = 400;
      passwordPolicy.assertPasswordValida.mockRejectedValueOnce(errorPolitica);

      await expect(cambiarPasswordObligatorio(1, 'corta', 'corta')).rejects.toBeInstanceOf(
        PasswordInvalidaError,
      );
      expect(repository.completarCambioPassword).not.toHaveBeenCalled();
    });

    it('rechaza si la contraseña y la confirmación no coinciden', async () => {
      await expect(
        cambiarPasswordObligatorio(1, 'NuevaClaveLargaSegura123!', 'OtraClaveLargaSegura123!'),
      ).rejects.toBeInstanceOf(PasswordInvalidaError);
      expect(repository.completarCambioPassword).not.toHaveBeenCalled();
    });
  });
});
