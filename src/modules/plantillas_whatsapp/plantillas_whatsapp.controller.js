const service = require('./plantillas_whatsapp.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto, nunca lee
// query params (mismo criterio de privacidad que doctores/areas.controller.js
// — el filtrado real ocurre por el POST de abajo, vía HTMX, sin tocar la URL).
async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('plantillas', { ...data, user: req.session.user, csrfToken });
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
    res.render('partials/plantillas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-613: fragmento HTMX con el formulario vacío ("Nueva plantilla"),
// swapeado dentro del modal.
async function nuevoForm(req, res, next) {
  try {
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantilla-form', {
      plantilla: null,
      intencion: '',
      texto_respuesta: '',
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// US-613: fragmento HTMX con el formulario precargado ("Editar plantilla").
async function editarForm(req, res, next) {
  try {
    const plantilla = await service.obtener(req.params.id);
    if (!plantilla) {
      return res.status(404).send('Plantilla no encontrada');
    }
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantilla-form', {
      plantilla,
      intencion: plantilla.intencion,
      texto_respuesta: plantilla.texto_respuesta,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Tras un alta/edición exitosa: la tabla se refresca vía un swap
// "out-of-band" (el formulario no vive dentro de #plantillas-panel, sino en
// el modal) y el header HX-Trigger le avisa al JS del cliente que cierre
// el modal — ver plantillas.ejs.
async function renderExito(req, res, next, csrfToken) {
  try {
    const data = await service.list({});
    res.set('HX-Trigger', 'closePlantillaModal');
    res.render('partials/plantillas-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-613 AC: alta sin id. Un error de validación o de intención duplicada
// no truena: re-renderiza el mismo formulario con el mensaje, sin cerrar
// el modal.
async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      intencion: req.body.intencion,
      texto_respuesta: req.body.texto_respuesta,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      return res.render('partials/plantilla-form', {
        plantilla: null,
        intencion: req.body.intencion ?? '',
        texto_respuesta: req.body.texto_respuesta ?? '',
        error: err.message,
        csrfToken,
        user: req.session.user,
      });
    }
    return next(err);
  }
  return renderExito(req, res, next, csrfToken);
}

// US-613 AC: edición con id — actualiza intención/texto_respuesta,
// conserva veces_usada. Mismo manejo de error que crear(), pero
// conservando la plantilla original en el formulario re-renderizado (sigue
// en modo "Editar plantilla").
async function editar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing) {
      return res.status(404).send('Plantilla no encontrada');
    }

    try {
      await service.editar({
        id: req.params.id,
        intencion: req.body.intencion,
        texto_respuesta: req.body.texto_respuesta,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        return res.render('partials/plantilla-form', {
          plantilla: existing,
          intencion: req.body.intencion ?? '',
          texto_respuesta: req.body.texto_respuesta ?? '',
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

module.exports = { list, filter, nuevoForm, editarForm, crear, editar };
