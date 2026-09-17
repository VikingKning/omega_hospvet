const { doubleCsrf } = require('csrf-csrf');
const env = require('./env');

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
