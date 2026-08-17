// Política de contraseñas del sistema (Bitácora de Decisiones Técnicas v5,
// Decisión 24) — aplica por igual a las 4 operaciones que establecen o
// modifican una contraseña (alta de usuario, cambio propio, restablecimiento
// administrativo, y su cambio obligatorio posterior). Vive en config/ (no en
// un módulo de negocio) a propósito: a diferencia de las validaciones de
// texto/correo/teléfono que cada módulo duplica intencionalmente, esta pieza
// (lista de comunes + llamada a Have I Been Pwned) tiene que ser
// BYTE-IDÉNTICA en los 3 módulos que la usan — duplicarla arriesgaría que la
// lista se desincronice entre copias, el problema que la independencia entre
// módulos normalmente no tiene porque cada copia es intencionalmente
// distinta a nivel de negocio.
const crypto = require('crypto');
const logger = require('./logger');

class PasswordPolicyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// La Decisión 24 pide "hasta 64 caracteres como mínimo" (passphrases) — 72
// no es una elección de negocio, es el techo real del algoritmo bcrypt
// (trunca cualquier byte después del 72; versiones recientes de la librería
// `bcrypt` de Node directamente lanzan un error). Fijar el máximo ahí
// cumple el mínimo pedido por el documento sin exponer al usuario a un
// límite silencioso más abajo.
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 72;

// Mensaje sugerido textual por la Decisión 24.
const MENSAJE_LONGITUD = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres. Puedes utilizar letras, números, símbolos y espacios.`;
const MENSAJE_COMUN_O_COMPROMETIDA =
  'Esta contraseña es demasiado común o ha sido comprometida anteriormente. Elige una contraseña diferente.';

// Lista mínima exigida por la Decisión 24, más variantes previsibles
// derivadas del nombre de la clínica/sistema (pedido explícito del
// documento: "nombres del sistema, clínica, empresa o combinaciones
// triviales derivadas de ellos"). Comparación case-insensitive contra la
// contraseña COMPLETA (nunca por fragmento/substring) — el documento es
// explícito en que "MiOmegaSuperSegura2026!" no debe rechazarse solo por
// contener "omega".
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password123',
    '12345678',
    '123456789',
    'qwerty123',
    'admin123',
    'letmein',
    'welcome',
    'contraseña',
    'contraseña123',
    'pwd123',
    'pass123456789',
    'omega',
    'omegavet',
    'omegavet123',
    'omegahospital',
    'hospitalveterinario',
    'hospvet',
    'veterinaria',
    'veterinaria123',
    'omega2025',
    'omega2026',
    'omegavet2025',
    'omegavet2026',
    'administrador',
    'admin12345',
    'omega123456789',
  ].map((valor) => valor.toLowerCase()),
);

function esComunOPredecible(password) {
  return COMMON_PASSWORDS.has(password.trim().toLowerCase());
}

// Longitud + lista de comunes/predecibles — la parte síncrona de la
// política, sin red. Se expone aparte de assertPasswordValida() para los
// pocos casos (contraseña temporal generada por el propio sistema, ver
// usuarios.service.js#generarPasswordTemporal) donde ni tiene sentido
// pedirle a un tercero (HIBP) que evalúe una cadena aleatoria que el propio
// servidor acaba de generar.
function validatePasswordPolicy(rawPassword) {
  const password = rawPassword ?? '';
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError(MENSAJE_LONGITUD);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordPolicyError(
      `La contraseña no puede tener más de ${PASSWORD_MAX_LENGTH} caracteres.`,
    );
  }
  if (esComunOPredecible(password)) {
    throw new PasswordPolicyError(MENSAJE_COMUN_O_COMPROMETIDA);
  }
}

// Timeout corto a propósito: esta llamada ocurre en medio de una petición
// que un usuario está esperando activamente (guardar su contraseña nueva),
// nunca en background.
const HIBP_TIMEOUT_MS = 3000;

// Have I Been Pwned, modelo k-anonimato (Decisión 24: "no se debe mandar la
// contraseña completa a ningún servicio externo"): se manda solo el prefijo
// de 5 caracteres del hash SHA-1, HIBP devuelve todos los sufijos que
// comparten ese prefijo, y la comparación final ocurre en este servidor —
// en ningún momento el servicio externo ve la contraseña completa ni
// siquiera su hash completo.
//
// Fail-open explícito (decisión tomada con el usuario): si HIBP no responde
// o tarda más de HIBP_TIMEOUT_MS, se registra un warning y se PERMITE
// continuar. La disponibilidad de un servicio de terceros no debe poder
// bloquear una operación de seguridad propia (cambiar tu contraseña) —
// mismo criterio que recomienda OWASP para este tipo de chequeo.
async function checkPasswordPwned(password) {
  const sha1 = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'OmegaVet-AdminSite (contacto: soporte interno)',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'HIBP respondió con error, continuando (fail-open)');
      return false;
    }

    const body = await res.text();
    return body
      .split('\n')
      .map((line) => line.trim())
      .some((line) => line.split(':')[0] === suffix);
  } catch (err) {
    logger.warn({ err }, 'HIBP no respondió a tiempo, continuando sin bloquear (fail-open)');
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Punto de entrada único para los 3 módulos que establecen contraseñas
// elegidas por una persona (perfil.service.js#cambiarPassword,
// usuarios.service.js#crear, auth.service.js#cambiarPasswordObligatorio):
// política síncrona -> "diferente a la actual" (solo si se pasa
// currentPassword, AC específico de un cambio VOLUNTARIO, no aplica al alta
// ni al cambio obligatorio tras un restablecimiento) -> HIBP.
async function assertPasswordValida(password, { currentPassword } = {}) {
  validatePasswordPolicy(password);

  if (currentPassword !== undefined && password === currentPassword) {
    throw new PasswordPolicyError('La nueva contraseña debe ser diferente a la contraseña actual.');
  }

  if (await checkPasswordPwned(password)) {
    throw new PasswordPolicyError(MENSAJE_COMUN_O_COMPROMETIDA);
  }
}

module.exports = {
  assertPasswordValida,
  validatePasswordPolicy,
  checkPasswordPwned,
  PasswordPolicyError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
};
