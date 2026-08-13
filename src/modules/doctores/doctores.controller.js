const service = require('./doctores.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto, nunca lee
// query params (así una URL pegada a mano nunca filtra nada — el filtrado
// real solo ocurre por el POST de abajo, vía HTMX, sin tocar la URL).
async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('doctores', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// Fragmento HTMX: recibe el filtro/orden/página completos en el body y
// devuelve solo el panel (toolbar + tabla + paginación), no la página
// entera. Reemite el token CSRF porque el fragmento vuelve a traer el
// <form> con su propio hx-headers.
async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-608: baja lógica de un doctor. Igual que filter(), recibe el estado de
// filtro/orden/página actual (el botón lo arrastra vía hx-include del mismo
// <form>) para que el fragmento devuelto refleje la vista donde el usuario
// ya estaba, no un estado por defecto.
//
// A diferencia de filter() (POST), aquí SÍ hace falta leer también
// req.query: la config por default de HTMX (`methodsThatUseUrlParams`)
// incluye "delete" junto con "get" — los valores incluidos vía hx-include
// viajan como query string en la URL del DELETE, no como body. Si solo se
// lee req.body (vacío en ese caso), el fragmento devuelto pierde el filtro
// activo del usuario silenciosamente (sin error, por eso no se notaba en
// curl — ahí el body se mandaba a mano).
async function desactivar(req, res, next) {
  try {
    await service.desactivar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, filter, desactivar };
