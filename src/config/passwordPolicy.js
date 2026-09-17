const crypto = require('crypto');
const logger = require('./logger');

class PasswordPolicyError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 72;

const MENSAJE_LONGITUD = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres. Puedes utilizar letras, números, símbolos y espacios.`;
const MENSAJE_COMUN_O_COMPROMETIDA =
  'Esta contraseña es demasiado común o ha sido comprometida anteriormente. Elige una contraseña diferente.';

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

const HIBP_TIMEOUT_MS = 3000;

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
