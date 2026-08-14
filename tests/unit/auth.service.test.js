const bcrypt = require('bcrypt');

jest.mock('../../src/modules/auth/auth.repository');
const repository = require('../../src/modules/auth/auth.repository');
const {
  login,
  InvalidCredentialsError,
  AccountLockedError,
  TemporaryLockError,
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
});
