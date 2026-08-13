const bcrypt = require('bcrypt');

jest.mock('../../src/modules/auth/auth.repository');
const repository = require('../../src/modules/auth/auth.repository');
const {
  login,
  InvalidCredentialsError,
  InactiveAccountError,
} = require('../../src/modules/auth/auth.service');
// El automock de Jest carga igual el módulo real del repository para
// inspeccionar su forma, lo que a su vez crea un pool de Knex real
// (config/database.js) aunque nunca se use: se cierra al terminar.
const db = require('../../src/config/database');

afterAll(() => db.destroy());

describe('auth.service.login', () => {
  const PASSWORD = 'CorrectHorseBattery1!';
  const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4); // costo bajo: solo son pruebas

  const activeUser = {
    id: 1,
    username: 'jdoe',
    password_hash: PASSWORD_HASH,
    activo: true,
    nombre: 'Jane',
    apellidos: 'Doe',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC3: credenciales correctas + cuenta activa -> resuelve permisos y actualiza último login', async () => {
    repository.findByUsername.mockResolvedValue(activeUser);
    repository.getPermissionCodes.mockResolvedValue(['agenda.ver', 'laboratorio.ver']);
    repository.touchLastLogin.mockResolvedValue();

    const result = await login('jdoe', PASSWORD);

    expect(result).toEqual({
      id: 1,
      username: 'jdoe',
      nombre: 'Jane',
      apellidos: 'Doe',
      permissions: ['agenda.ver', 'laboratorio.ver'],
    });
    expect(repository.touchLastLogin).toHaveBeenCalledWith(1);
  });

  it('AC4: usuario inexistente -> InvalidCredentialsError (mensaje genérico)', async () => {
    repository.findByUsername.mockResolvedValue(undefined);

    await expect(login('no-existe', PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(repository.getPermissionCodes).not.toHaveBeenCalled();
  });

  it('AC4: contraseña incorrecta -> InvalidCredentialsError, mismo tipo que usuario inexistente', async () => {
    repository.findByUsername.mockResolvedValue(activeUser);

    await expect(login('jdoe', 'contraseña-incorrecta')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('AC4: el mensaje es idéntico exista o no el usuario (no revela existencia)', async () => {
    repository.findByUsername.mockResolvedValueOnce(undefined);
    let mensajeUsuarioInexistente;
    try {
      await login('no-existe', PASSWORD);
    } catch (err) {
      mensajeUsuarioInexistente = err.message;
    }

    repository.findByUsername.mockResolvedValueOnce(activeUser);
    let mensajeContrasenaIncorrecta;
    try {
      await login('jdoe', 'otra-cosa');
    } catch (err) {
      mensajeContrasenaIncorrecta = err.message;
    }

    expect(mensajeUsuarioInexistente).toBe(mensajeContrasenaIncorrecta);
  });

  it('AC5: cuenta desactivada + credenciales correctas -> InactiveAccountError', async () => {
    repository.findByUsername.mockResolvedValue({ ...activeUser, activo: false });

    await expect(login('jdoe', PASSWORD)).rejects.toBeInstanceOf(InactiveAccountError);
    expect(repository.touchLastLogin).not.toHaveBeenCalled();
  });

  it('AC5: cuenta desactivada + contraseña incorrecta -> sigue siendo InvalidCredentialsError, no revela que la cuenta existe', async () => {
    repository.findByUsername.mockResolvedValue({ ...activeUser, activo: false });

    await expect(login('jdoe', 'otra-cosa')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
