const { doubleCsrf } = require('csrf-csrf');
const env = require('./env');

// csrf-csrf@4 ata el token a un identificador de sesión (getSessionIdentifier)
// y por defecto usa una cookie con prefijo __Host- (requiere HTTPS siempre).
// Se sobreescribe el nombre de cookie para que funcione también en localhost
// sobre HTTP en desarrollo.
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => env.sessionSecret,
  getSessionIdentifier: (req) => req.session.id,
  cookieName: 'omega.csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
  },
  errorConfig: {
    message: 'Token CSRF inválido o ausente.',
  },
});

module.exports = { generateCsrfToken, doubleCsrfProtection };
