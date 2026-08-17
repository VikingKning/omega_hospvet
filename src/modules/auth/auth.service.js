const bcrypt = require('bcrypt');
const repository = require('./auth.repository');
const { assertPasswordValida } = require('../../config/passwordPolicy');

class InvalidCredentialsError extends Error {
  constructor() {
    super('Usuario o contraseña incorrectos.');
    this.status = 401;
  }
}

// US-106: bloqueo permanente (15+ intentos fallidos) — solo un
// administrador puede levantarlo (fuera del alcance de esta historia).
class AccountLockedError extends Error {
  constructor() {
    super('Cuenta bloqueada. Favor de contactar con el administrador.');
    this.status = 403;
  }
}

// US-106: bloqueo temporal (5 o 10 intentos fallidos), todavía vigente.
class TemporaryLockError extends Error {
  constructor(minutos) {
    super(
      `Cuenta bloqueada temporalmente. Favor de esperar ${minutos} minutos antes de volver a intentarlo.`,
    );
    this.status = 403;
  }
}

// Hash "señuelo" con el mismo costo de bcrypt que un hash real, para que
// bcrypt.compare tarde lo mismo exista o no el usuario. Sin esto, un
// atacante podría medir el tiempo de respuesta para descubrir qué usuarios
// existen, incluso devolviendo siempre el mismo mensaje de error (AC4 de
// US-101). Se sigue calculando aunque el resultado no importe (usuario
// inactivo/bloqueado) para no filtrar el estado de la cuenta por timing.
const DUMMY_HASH = bcrypt.hashSync('omega-dummy-password-para-timing-seguro', 12);

// US-106: umbral a partir del cual el bloqueo temporal pasa de 15 a 30
// minutos (a los 5 es 15 min, a los 10 es 30 min).
const UMBRAL_BLOQUEO_30_MIN = 10;
const DURACION_BLOQUEO_15_MIN = 15;
const DURACION_BLOQUEO_30_MIN = 30;

// Minutos restantes del bloqueo vigente, redondeados hacia arriba para
// nunca mostrar "0 minutos" mientras técnicamente el bloqueo sigue activo.
function minutosRestantes(bloqueadoEn, duracionMin) {
  const desbloqueaEn = new Date(bloqueadoEn).getTime() + duracionMin * 60_000;
  return Math.max(1, Math.ceil((desbloqueaEn - Date.now()) / 60_000));
}

// null si el bloqueo temporal ya expiró (puede evaluarse la contraseña);
// si no, la duración (en minutos) del bloqueo vigente, para calcular cuánto
// falta. La duración depende de cuántos intentos ya lleva acumulados: 15
// min para el primer umbral (5), 30 min para el segundo (10) — ver AC de la
// historia.
function duracionBloqueoVigente(user) {
  const duracionMin =
    user.intentos_fallidos >= UMBRAL_BLOQUEO_30_MIN
      ? DURACION_BLOQUEO_30_MIN
      : DURACION_BLOQUEO_15_MIN;
  const desbloqueaEn = new Date(user.bloqueado_en).getTime() + duracionMin * 60_000;
  return Date.now() < desbloqueaEn ? duracionMin : null;
}

// US-106: máquina de estados de `usuarios.estatus` (activo | bloqueo_temp |
// bloqueado | inactivo) + `intentos_fallidos`/`bloqueado_en`, en vez de un
// store de rate-limiting en memoria — así el bloqueo PERMANENTE (15
// intentos) sobrevive un reinicio del servidor, que es lo que "permanente"
// exige. Sigue el flujo PASO 1-6 acordado con el cliente.
async function login(username, password) {
  const user = await repository.findByUsername(username);
  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  // PASO 1: no existe, o fue dado de baja por un administrador (inactivo) —
  // mismo mensaje genérico que credenciales incorrectas (AC4 de US-101,
  // extendido aquí a "inactivo" también). No es un intento real contra esta
  // cuenta si ni siquiera está activa, así que no se toca el contador.
  if (!user || user.estatus === 'inactivo') {
    throw new InvalidCredentialsError();
  }

  // PASO 1: bloqueo permanente — rechaza sin evaluar la contraseña ni tocar
  // el contador.
  if (user.estatus === 'bloqueado') {
    throw new AccountLockedError();
  }

  // PASO 2/3: bloqueo temporal todavía vigente — rechaza sin evaluar la
  // contraseña ni tocar el contador. Si ya expiró, sigue de largo al PASO 4
  // sin tocar `estatus` todavía (la fila sigue diciendo 'bloqueo_temp' hasta
  // que el PASO 5/6 la resuelva según el resultado de la contraseña).
  if (user.estatus === 'bloqueo_temp') {
    const duracionVigente = duracionBloqueoVigente(user);
    if (duracionVigente !== null) {
      throw new TemporaryLockError(minutosRestantes(user.bloqueado_en, duracionVigente));
    }
  }

  // US-605: estatus='cambio_pwd' — la "contraseña" que se está evaluando es
  // la temporal generada por un restablecimiento administrativo. Tiene su
  // propio contador de intentos fallidos (ver
  // registrarIntentoFallidoCambioPwd: 5 intentos -> bloqueado directo, SIN
  // el bloqueo_temp intermedio de 15/30 min del PASO 6 normal — así lo pide
  // el AC). Si es correcta, NO se abre una sesión normal: se devuelve
  // `mustChangePassword: true` para que el controller arme una sesión
  // restringida (sin permisos reales) que requireAuth.js confina a
  // /cambiar-password hasta que complete el cambio obligatorio — el
  // usuario nunca llega a "estar activo" solo por acertar la temporal.
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

  // PASO 6: contraseña incorrecta — incrementa el contador (y escala el
  // estatus si cruza un umbral).
  if (!passwordMatches) {
    await repository.registrarIntentoFallido(user.id, user.intentos_fallidos);
    throw new InvalidCredentialsError();
  }

  // PASO 5: contraseña correcta — resetea el contador/estatus, resuelve
  // permisos y registra el último login.
  const [permissions] = await Promise.all([
    repository.getPermissionCodes(user.id),
    repository.resetIntentosYLogin(user.id),
  ]);

  return {
    id: user.id,
    username: user.username,
    nombre: user.nombre,
    apellidos: user.apellidos,
    permissions,
  };
}

// US-605: paso final del cambio obligatorio de contraseña — valida la
// nueva contraseña contra la política compartida del sistema
// (passwordPolicy.js#assertPasswordValida, Decisión 24 de la Bitácora v5:
// mínimo 15, lista de comunes/predecibles, HIBP). No se pasa
// `currentPassword`: la regla "diferente a la actual" es específica de un
// cambio VOLUNTARIO (ver perfil.service.js#cambiarPassword, US-110); aquí
// el usuario está saliendo de una contraseña TEMPORAL generada por un
// administrador, no comparando contra una que él mismo eligió. No valida
// el estatus actual del usuario aquí: requireAuth.js ya garantiza que solo
// una sesión con mustChangePassword=true puede llegar a este endpoint.
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
