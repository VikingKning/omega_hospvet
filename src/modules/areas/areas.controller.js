const service = require('./areas.service');
const { generateCsrfToken } = require('../../config/csrf');
const { GOOGLE_CALENDAR_COLORS } = require('./googleCalendarColors');

async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('areas', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/areas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

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

async function activar(req, res, next) {
  try {
    await service.activar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/areas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function nuevoForm(req, res, next) {
  try {
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/area-form', {
      area: null,
      nombre: '',
      color: null, // "Sin color" preseleccionado por defecto en el alta
      colores: GOOGLE_CALENDAR_COLORS,
      soloLectura: false,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

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
      soloLectura: false,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function verForm(req, res, next) {
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
      soloLectura: true,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function renderExito(req, res, next, csrfToken) {
  try {
    const data = await service.list({});
    res.set('HX-Trigger', 'closeAreaModal');
    res.render('partials/areas-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

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
        soloLectura: false,
        error: err.message,
        csrfToken,
        user: req.session.user,
      });
    }
    return next(err);
  }
  return renderExito(req, res, next, csrfToken);
}

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
          soloLectura: false,
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

module.exports = {
  list,
  filter,
  desactivar,
  activar,
  nuevoForm,
  editarForm,
  verForm,
  crear,
  editar,
};
