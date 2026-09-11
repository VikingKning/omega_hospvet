const logger = require('../config/logger');
const hxRedirect = require('./hxRedirect');
const attachSidebarAreas = require('./attachSidebarAreas');

// Pedido explícito del usuario: una URL inexistente ya no responde un JSON
// crudo ({error:'No encontrado'}) — eso solo tiene sentido para un cliente
// programático (fetch/HTMX), nunca para alguien que navegó a mano a una
// ruta que no existe. Sin sesión activa NUNCA se muestra la página 404 (ni
// nada del sistema) — mismo criterio que requireAuth.js: siempre se manda a
// login, para no revelar que la URL "casi" existe. `attachSidebarAreas` se
// invoca a mano (no está en la cadena de app.use como en las páginas
// normales) porque notFound es el único lugar de la app que renderiza una
// página completa fuera de una ruta ya registrada.
function notFound(req, res, next) {
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
