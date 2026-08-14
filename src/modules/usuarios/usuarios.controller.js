const service = require('./usuarios.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto, nunca lee
// query params (mismo criterio de privacidad que el resto de los
// catálogos de Configuraciones — el filtrado real ocurre por el POST de
// abajo, vía HTMX, sin tocar la URL).
async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('usuarios', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// Fragmento HTMX: recibe el filtro/orden/página completos en el body y
// devuelve solo el panel (toolbar + tabla + paginación), no la página
// entera.
async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuarios-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, filter };
