const service = require('./areas.service');
const { generateCsrfToken } = require('../../config/csrf');
const { GOOGLE_CALENDAR_COLORS } = require('./googleCalendarColors');

// Carga inicial de la página: siempre el estado por defecto, nunca lee
// query params (mismo criterio de privacidad que doctores.controller.js —
// el filtrado real ocurre por el POST de abajo, vía HTMX, sin tocar la URL).
async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('areas', { ...data, user: req.session.user, csrfToken });
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
    res.render('partials/areas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-611: baja lógica de un área. Igual que filter(), recibe el estado de
// filtro/orden/página actual (el botón lo arrastra vía hx-include del mismo
// <form>) para que el fragmento devuelto refleje la vista donde el usuario
// ya estaba, no un estado por defecto.
//
// A diferencia de filter() (POST), aquí SÍ hace falta leer también
// req.query: la config por default de HTMX (`methodsThatUseUrlParams`)
// incluye "delete" junto con "get" — los valores incluidos vía hx-include
// viajan como query string en la URL del DELETE, no como body (mismo
// gotcha ya documentado en doctores.controller.js).
async function desactivar(req, res, next) {
  try {
    await service.desactivar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/areas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-610: fragmento HTMX con el formulario vacío ("Nueva área"), swapeado
// dentro del modal.
async function nuevoForm(req, res, next) {
  try {
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/area-form', {
      area: null,
      nombre: '',
      color: null, // "Sin color" preseleccionado por defecto en el alta
      colores: GOOGLE_CALENDAR_COLORS,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// US-610: fragmento HTMX con el formulario precargado ("Editar área"), con
// el slug en modo solo-lectura.
async function editarForm(req, res, next) {
  try {
    const area = await service.obtener(req.params.id);
    if (!area) {
      return res.status(404).send('Área no encontrada');
    }
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/area-form', {
      area,
      nombre: area.nombre,
      color: area.color_google_calendar,
      colores: GOOGLE_CALENDAR_COLORS,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Tras un alta/edición exitosa: la tabla se refresca vía un swap
// "out-of-band" (el fragmento normal que responde a esta petición no
// vive dentro de #areas-panel, sino en el modal) y el header HX-Trigger le
// avisa al JS del cliente que cierre el modal — ver areas.ejs.
async function renderExito(req, res, next, csrfToken) {
  try {
    const data = await service.list({});
    res.set('HX-Trigger', 'closeAreaModal');
    res.render('partials/areas-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-610 AC: alta sin id — el service genera el slug a partir del nombre.
// Un nombre vacío o duplicado (entre áreas ACTIVAS) no truena: re-renderiza
// el mismo formulario con el mensaje de error, sin cerrar el modal.
async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      nombre: req.body.nombre,
      color: req.body.color,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      return res.render('partials/area-form', {
        area: null,
        nombre: req.body.nombre ?? '',
        color: req.body.color ?? '',
        colores: GOOGLE_CALENDAR_COLORS,
        error: err.message,
        csrfToken,
        user: req.session.user,
      });
    }
    return next(err);
  }
  return renderExito(req, res, next, csrfToken);
}

// US-610 AC: edición con id — actualiza solo el nombre, el slug nunca se
// toca. Mismo manejo de error que crear(), pero conservando el slug/id
// originales en el formulario re-renderizado (sigue en modo "Editar área").
async function editar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing) {
      return res.status(404).send('Área no encontrada');
    }

    try {
      await service.editar({
        id: req.params.id,
        nombre: req.body.nombre,
        color: req.body.color,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        return res.render('partials/area-form', {
          area: existing,
          nombre: req.body.nombre ?? '',
          color: req.body.color ?? '',
          colores: GOOGLE_CALENDAR_COLORS,
          error: err.message,
          csrfToken,
          user: req.session.user,
        });
      }
      throw err;
    }

    return renderExito(req, res, next, csrfToken);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, filter, desactivar, nuevoForm, editarForm, crear, editar };
