const logger = require('../config/logger');
const hxRedirect = require('./hxRedirect');
const attachSidebarAreas = require('./attachSidebarAreas');

function notFound(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!req.session.user) {
    return hxRedirect(req, res, '/');
  }
  attachSidebarAreas(req, res, (err) => {
    if (err) return next(err);
    res.status(404).render('404', { user: req.session.user });
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error({ err, path: req.path, method: req.method }, 'Error no controlado');

  const status = err.status || 500;
  const message = status === 500 ? 'Error interno del servidor' : err.message;

  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
