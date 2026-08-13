const bcrypt = require('bcrypt');
const repository = require('./auth.repository');

class InvalidCredentialsError extends Error {
  constructor() {
    super('Usuario o contraseña incorrectos.');
    this.status = 401;
  }
}

class InactiveAccountError extends Error {
  constructor() {
    super('Esta cuenta está desactivada. Contacta a un administrador.');
    this.status = 403;
  }
}

// Hash "señuelo" con el mismo costo de bcrypt que un hash real, para que
// bcrypt.compare tarde lo mismo exista o no el usuario. Sin esto, un
// atacante podría medir el tiempo de respuesta para descubrir qué usuarios
// existen, incluso devolviendo siempre el mismo mensaje de error (AC4).
const DUMMY_HASH = bcrypt.hashSync('omega-dummy-password-para-timing-seguro', 12);

async function login(username, password) {
  const user = await repository.findByUsername(username);
  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  // Mismo error para "no existe" y "contraseña incorrecta": el mensaje
  // genérico no revela si el usuario existe (AC4).
  if (!user || !passwordMatches) {
    throw new InvalidCredentialsError();
  }

  // Solo se distingue "cuenta inactiva" una vez confirmada la contraseña
  // correcta (AC5) — así no se filtra el estado de la cuenta a quien no
  // conoce la contraseña.
  if (!user.activo) {
    throw new InactiveAccountError();
  }

  const [permissions] = await Promise.all([
    repository.getPermissionCodes(user.id),
    repository.touchLastLogin(user.id),
  ]);

  return {
    id: user.id,
    username: user.username,
    nombre: user.nombre,
    apellidos: user.apellidos,
    permissions,
  };
}

module.exports = { login, InvalidCredentialsError, InactiveAccountError };
