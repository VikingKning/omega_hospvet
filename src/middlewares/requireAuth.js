const hxRedirect = require('./hxRedirect');

const ABSOLUTE_SESSION_MAX_MS = 8 * 60 * 60 * 1000; // Límite absoluto de sesión.

const INACTIVITY_MAX_MS = 30 * 60 * 1000;

const RUTAS_EXENTAS_CAMBIO_PASSWORD = ['/cambiar-password', '/logout'];

function expirarSesion(req, res, motivo) {
  return req.session.destroy(() => {
    res.clearCookie('omega.sid');
    hxRedirect(req, res, `/?expired=${motivo}`);
  });
}

function requireAuth(req, res, next) {
  res.set('Cache-Control', 'no-store');

  const { user, loginAt, lastActivityAt } = req.session;

  if (!user || !loginAt) {
    return hxRedirect(req, res, '/');
  }

  if (Date.now() - loginAt > ABSOLUTE_SESSION_MAX_MS) {
    return expirarSesion(req, res, 'absoluto');
  }

  if (lastActivityAt && Date.now() - lastActivityAt > INACTIVITY_MAX_MS) {
    return expirarSesion(req, res, 'inactividad');
  }

  if (user.mustChangePassword && !RUTAS_EXENTAS_CAMBIO_PASSWORD.includes(req.path)) {
    return hxRedirect(req, res, '/cambiar-password');
  }

  req.session.lastActivityAt = Date.now();
  next();
}

module.exports = requireAuth;
module.exports.ABSOLUTE_SESSION_MAX_MS = ABSOLUTE_SESSION_MAX_MS;
module.exports.INACTIVITY_MAX_MS = INACTIVITY_MAX_MS;
