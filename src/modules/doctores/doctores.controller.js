const service = require('./doctores.service');
const { generateCsrfToken } = require('../../config/csrf');

async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('doctores', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctores-panel', { ...data, user: req.session.user, csrfToken });
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
    res.render('partials/doctores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function nuevoForm(req, res, next) {
  try {
    const areasDisponibles = await service.listAreasDisponibles();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctor-form', {
      doctor: null,
      nombre: '',
      apellidos: '',
      activo: true,
      areasDisponibles,
      areasSeleccionadas: [],
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
    const doctor = await service.obtener(req.params.id);
    if (!doctor) {
      return res.status(404).send('Doctor no encontrado');
    }
    const areasDisponibles = await service.listAreasDisponibles();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctor-form', {
      doctor,
      nombre: doctor.nombre,
      apellidos: doctor.apellidos,
      activo: doctor.activo,
      areasDisponibles,
      areasSeleccionadas: doctor.areas,
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
    const doctor = await service.obtener(req.params.id);
    if (!doctor) {
      return res.status(404).send('Doctor no encontrado');
    }
    const areasDisponibles = await service.listAreasDisponibles();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctor-form', {
      doctor,
      nombre: doctor.nombre,
      apellidos: doctor.apellidos,
      activo: doctor.activo,
      areasDisponibles,
      areasSeleccionadas: doctor.areas,
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
    res.set('HX-Trigger', 'closeDoctorModal');
    res.render('partials/doctores-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      activo: req.body.activo,
      areaIds: req.body.areaIds,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      const [areasDisponibles, areasSeleccionadas] = await Promise.all([
        service.listAreasDisponibles(),
        service.resolverAreas(req.body.areaIds),
      ]);
      return res.render('partials/doctor-form', {
        doctor: null,
        nombre: req.body.nombre ?? '',
        apellidos: req.body.apellidos ?? '',
        activo: req.body.activo === 'true',
        areasDisponibles,
        areasSeleccionadas,
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
      return res.status(404).send('Doctor no encontrado');
    }

    try {
      await service.editar({
        id: req.params.id,
        nombre: req.body.nombre,
        apellidos: req.body.apellidos,
        activo: req.body.activo,
        areaIds: req.body.areaIds,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        const [areasDisponibles, areasSeleccionadas] = await Promise.all([
          service.listAreasDisponibles(),
          service.resolverAreas(req.body.areaIds),
        ]);
        return res.render('partials/doctor-form', {
          doctor: existing,
          nombre: req.body.nombre ?? '',
          apellidos: req.body.apellidos ?? '',
          activo: req.body.activo === 'true',
          areasDisponibles,
          areasSeleccionadas,
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

module.exports = { list, filter, desactivar, nuevoForm, editarForm, verForm, crear, editar };
