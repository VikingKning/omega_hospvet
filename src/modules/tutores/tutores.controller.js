const service = require('./tutores.service');
const { generateCsrfToken } = require('../../config/csrf');

async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    const error =
      req.query.error === 'no-encontrado' ? `El propietario "${req.query.id}" no existe.` : null;
    res.render('tutores', { ...data, user: req.session.user, csrfToken, error });
  } catch (err) {
    next(err);
  }
}

async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/tutores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

function nuevoForm(req, res) {
  const csrfToken = generateCsrfToken(req, res);
  res.render('tutor-form', {
    propietario: null,
    pacientes: [],
    soloLectura: false,
    user: req.session.user,
    csrfToken,
  });
}

async function editarForm(req, res, next) {
  try {
    const propietario = await service.obtenerParaEditar(req.params.id);
    if (!propietario) {
      return res.redirect(
        `/tutores.html?error=no-encontrado&id=${encodeURIComponent(req.params.id)}`,
      );
    }
    const csrfToken = generateCsrfToken(req, res);
    res.render('tutor-form', {
      propietario,
      pacientes: propietario.pacientes,
      soloLectura: false,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

async function verForm(req, res, next) {
  try {
    const propietario = await service.obtenerParaEditar(req.params.id);
    if (!propietario) {
      return res.redirect(
        `/tutores.html?error=no-encontrado&id=${encodeURIComponent(req.params.id)}`,
      );
    }
    const csrfToken = generateCsrfToken(req, res);
    res.render('tutor-form', {
      propietario,
      pacientes: propietario.pacientes,
      soloLectura: true,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    const id = await service.crear({
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      telefono: req.body.telefono,
      correo: req.body.correo,
      pacientes: req.body.pacientes,
      confirmarReactivacion: req.body.confirmarReactivacion === true,
      usuarioId: req.session.user.id,
    });
    const propietario = await service.obtenerParaEditar(id);
    res.json({ id, redirectTo: '/tutores.html', propietario });
  } catch (err) {
    if (err instanceof service.RequiereConfirmacionReactivacionError) {
      return res.json({ requiereConfirmacion: true, tutorExistente: err.tutorExistente });
    }
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

async function editar(req, res, next) {
  try {
    const id = await service.editar({
      id: req.params.id,
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      telefono: req.body.telefono,
      correo: req.body.correo,
      activo: req.body.activo,
      pacientes: req.body.pacientes,
      usuarioId: req.session.user.id,
    });
    const propietario = await service.obtenerParaEditar(id);
    res.json({ id, redirectTo: '/tutores.html', propietario });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

async function buscarTelefono(req, res, next) {
  try {
    const resultados = await service.buscarPorTelefono(req.body.q);
    res.json(resultados);
  } catch (err) {
    next(err);
  }
}

async function buscarMascota(req, res, next) {
  try {
    const resultados = await service.buscarMascotas(req.body.q);
    res.json(resultados);
  } catch (err) {
    next(err);
  }
}

async function verificarTelefono(req, res, next) {
  try {
    const resultado = await service.verificarTelefono(req.body.telefono);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function buscarTutorTelefono(req, res, next) {
  try {
    const tutor = await service.resolverTutorActivoPorTelefono(req.body.telefono);
    res.json(tutor ? { existe: true, tutor } : { existe: false });
  } catch (err) {
    next(err);
  }
}

async function buscarTutorNombre(req, res, next) {
  try {
    const tutores = await service.buscarActivosPorNombre(req.body.q);
    res.json({ tutores });
  } catch (err) {
    next(err);
  }
}

async function desactivar(req, res, next) {
  try {
    await service.desactivar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/tutores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  filter,
  nuevoForm,
  editarForm,
  verForm,
  crear,
  editar,
  buscarTelefono,
  buscarMascota,
  verificarTelefono,
  buscarTutorTelefono,
  buscarTutorNombre,
  desactivar,
};
