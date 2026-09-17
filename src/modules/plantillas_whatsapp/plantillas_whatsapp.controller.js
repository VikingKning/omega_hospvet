const service = require('./plantillas_whatsapp.service');
const metaSync = require('./plantillas_whatsapp.metaSync');
const { generateCsrfToken } = require('../../config/csrf');

async function list(req, res, next) {
  try {
    await metaSync.revisarAprobaciones();
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('plantillas', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantillas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function desactivar(req, res, next) {
  try {
    await service.desactivar(req.params.id, req.session.user.id);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).send(err.message);
    }
    return next(err);
  }

  try {
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantillas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function nuevoForm(req, res, next) {
  try {
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantilla-form', {
      plantilla: null,
      intencion: '',
      texto_respuesta: '',
      es_emergencia: false,
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
    const plantilla = await service.obtener(req.params.id);
    if (!plantilla) {
      return res.status(404).send('Plantilla no encontrada');
    }
    res.render('partials/plantilla-detalle', { plantilla });
  } catch (err) {
    next(err);
  }
}

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
      slug: plantilla.slug,
      texto_respuesta: plantilla.texto_respuesta,
      activo: plantilla.activo,
      es_emergencia: plantilla.es_emergencia,
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
    res.set('HX-Trigger', 'closePlantillaModal');
    res.render('partials/plantillas-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      intencion: req.body.intencion,
      texto_respuesta: req.body.texto_respuesta,
      es_emergencia: req.body.es_emergencia,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      return res.render('partials/plantilla-form', {
        plantilla: null,
        intencion: req.body.intencion ?? '',
        texto_respuesta: req.body.texto_respuesta ?? '',
        es_emergencia: req.body.es_emergencia === 'true',
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
      return res.status(404).send('Plantilla no encontrada');
    }

    try {
      await service.editar({
        id: req.params.id,
        texto_respuesta: req.body.texto_respuesta,
        activo: req.body.activo,
        es_emergencia: req.body.es_emergencia,
        esPredeterminada: existing.es_predeterminada,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        return res.render('partials/plantilla-form', {
          plantilla: existing,
          intencion: existing.intencion,
          slug: existing.slug,
          texto_respuesta: req.body.texto_respuesta ?? '',
          activo: req.body.activo === 'true',
          es_emergencia: req.body.es_emergencia === 'true',
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

module.exports = { list, filter, desactivar, nuevoForm, verForm, editarForm, crear, editar };
