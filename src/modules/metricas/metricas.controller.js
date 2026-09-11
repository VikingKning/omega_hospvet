const service = require('./metricas.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el rango por defecto (últimos 30
// días), nunca lee query params — mismo criterio que
// laboratorio.controller.js#pagina, el filtrado real solo ocurre por el
// POST de abajo, vía HTMX, sin tocar la URL (privacidad, mismo criterio ya
// confirmado para el buscador de las tablas).
async function pagina(req, res, next) {
  try {
    const data = await service.obtenerMetricasLaboratorio({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('metricas-laboratorio', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// Fragmento HTMX: rango de fechas completo en el body, devuelve solo el
// panel (formulario de rango + tarjetas + gráficas) — mismo patrón que
// laboratorio.controller.js#filter.
async function filter(req, res, next) {
  try {
    const data = await service.obtenerMetricasLaboratorio(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/metricas-laboratorio-panel', {
      ...data,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { pagina, filter };
