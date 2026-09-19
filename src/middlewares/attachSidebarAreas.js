const db = require('../config/database');

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
