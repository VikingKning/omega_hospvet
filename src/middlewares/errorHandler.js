const logger = require('../config/logger');

function notFound(req, res) {
  res.status(404).json({ error: 'No encontrado' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error({ err, path: req.path, method: req.method }, 'Error no controlado');

  const status = err.status || 500;
  const message = status === 500 ? 'Error interno del servidor' : err.message;

  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
