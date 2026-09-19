const bcrypt = require('bcrypt');
const repository = require('./auth.repository');
const { assertPasswordValida } = require('../../config/passwordPolicy');

class InvalidCredentialsError extends Error {
  constructor() {
    super('Usuario o contraseña incorrectos.');
    this.status = 401;
  }
}

class AccountLockedError extends Error {
  constructor() {
    super('Cuenta bloqueada. Favor de contactar con el administrador.');
    this.status = 403;
  }
}

class TemporaryLockError extends Error {
  constructor(minutos) {
    super(
      `Cuenta bloqueada temporalmente. Favor de esperar ${minutos} minutos antes de volver a intentarlo.`,
    );
    this.status = 403;
  }
}

const DUMMY_HASH = bcrypt.hashSync('omega-dummy-password-para-timing-seguro', 12);

const UMBRAL_BLOQUEO_30_MIN = 10;
const DURACION_BLOQUEO_15_MIN = 15;
const DURACION_BLOQUEO_30_MIN = 30;

function minutosRestantes(bloqueadoEn, duracionMin) {
  const desbloqueaEn = new Date(bloqueadoEn).getTime() + duracionMin * 60_000;
  return Math.max(1, Math.ceil((desbloqueaEn - Date.now()) / 60_000));
}

function duracionBloqueoVigente(user) {
  const duracionMin =
    user.intentos_fallidos >= UMBRAL_BLOQUEO_30_MIN
      ? DURACION_BLOQUEO_30_MIN
      : DURACION_BLOQUEO_15_MIN;
  const desbloqueaEn = new Date(user.bloqueado_en).getTime() + duracionMin * 60_000;
  return Date.now() < desbloqueaEn ? duracionMin : null;
}

async function login(username, password) {
  const user = await repository.findByUsername(username);
  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || user.estatus === 'inactivo') {
    throw new InvalidCredentialsError();
  }

  if (user.estatus === 'bloqueado') {
    throw new AccountLockedError();
  }

  if (user.estatus === 'bloqueo_temp') {
    const duracionVigente = duracionBloqueoVigente(user);
    if (duracionVigente !== null) {
      throw new TemporaryLockError(minutosRestantes(user.bloqueado_en, duracionVigente));
    }
  }

  if (user.estatus === 'cambio_pwd') {
    if (!passwordMatches) {
      await repository.registrarIntentoFallidoCambioPwd(user.id, user.intentos_fallidos);
      throw new InvalidCredentialsError();
    }

    await repository.resetIntentosCambioPwd(user.id);
    return {
      id: user.id,
      username: user.username,
      nombre: user.nombre,
      apellidos: user.apellidos,
      permissions: [],
      mustChangePassword: true,
    };
  }

  if (!passwordMatches) {
    await repository.registrarIntentoFallido(user.id, user.intentos_fallidos);
    throw new InvalidCredentialsError();
  }

  const [permissions] = await Promise.all([
    repository.getPermissionCodes(user.id),
    repository.resetIntentosYLogin(user.id),
  ]);

  return {
    id: user.id,
    username: user.username,
    nombre: user.nombre,
    apellidos: user.apellidos,
    doctorId: user.doctor_id,
    avatar: user.avatar,
    permissions,
  };
}

class PasswordInvalidaError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

async function cambiarPasswordObligatorio(usuarioId, rawPassword, rawConfirmacion) {
  const password = rawPassword ?? '';
  const confirmacion = rawConfirmacion ?? '';

  try {
    await assertPasswordValida(password);
  } catch (err) {
    throw new PasswordInvalidaError(err.message);
  }
  if (password !== confirmacion) {
    throw new PasswordInvalidaError('Las contraseñas no coinciden.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await repository.completarCambioPassword(usuarioId, passwordHash);
  return repository.getPermissionCodes(usuarioId);
}

module.exports = {
  login,
  cambiarPasswordObligatorio,
  InvalidCredentialsError,
  AccountLockedError,
  TemporaryLockError,
  PasswordInvalidaError,
};
