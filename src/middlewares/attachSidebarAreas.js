const db = require('../config/database');

// Alimenta el submenú "Agenda" de partials/sidebar.ejs, que necesita listar
// cada área activa como su propia fila — mismo criterio que ya usa el tab
// "Agendas" de la matriz de permisos (usuarios.service.js#construirTabAgendas):
// las filas se leen EN VIVO de la tabla `areas`, nunca de un catálogo fijo
// en código, para que un área nueva aparezca sola sin tocar este archivo.
//
// Vive en middlewares/ (no en un módulo de dominio) porque es infraestructura
// transversal: CUALQUIER página completa incluye el sidebar, así que esta
// única consulta reemplaza tener que duplicarla en cada controller que
// renderiza una página — se encadena explícitamente después de requireAuth
// en cada ruta que renderiza una página completa (nunca en fragmentos HTMX,
// que no incluyen el sidebar), mismo criterio de "la regla vive en un solo
// lugar, auditable" que requirePermission.js. `res.locals` se mezcla
// automáticamente en cada res.render() (mismo mecanismo que cspNonce en
// app.js), así que sidebar.ejs lee `areasAgendaSidebar` sin que cada
// controller tenga que pasarla a mano.
async function attachSidebarAreas(req, res, next) {
  try {
    res.locals.areasAgendaSidebar = await db('areas')
      .where({ activo: true })
      .orderBy('nombre')
      .select('id', 'nombre', 'slug');
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = attachSidebarAreas;
