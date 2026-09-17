const service = require('./laboratorio.service');
const { generateCsrfToken } = require('../../config/csrf');
const fs = require('fs');

async function pagina(req, res, next) {
  try {
    const data = await service.list({});
    const categorias = await service.listCategorias();
    const csrfToken = generateCsrfToken(req, res);
    const error =
      req.query.error === 'no-encontrado' ? `El registro "${req.query.id}" no existe.` : null;
    res.render('laboratorio', { ...data, categorias, user: req.session.user, csrfToken, error });
  } catch (err) {
    next(err);
  }
}

async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const categorias = await service.listCategorias();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/laboratorio-panel', {
      ...data,
      categorias,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    await service.eliminar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const categorias = await service.listCategorias();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/laboratorio-panel', {
      ...data,
      categorias,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

async function nuevoForm(req, res, next) {
  try {
    const [catalogo, doctores] = await Promise.all([
      service.catalogoParaFormulario(),
      service.listarDoctoresActivos(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('laboratorio-form', {
      registro: null,
      doctorIdPreseleccionado: req.session.user.doctorId ?? null,
      soloLectura: false,
      modoCargarArchivos: false,
      catalogo,
      doctores,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function formularioDeRegistro(req, res, next, { forzarSoloLectura, modoCargarArchivos }) {
  try {
    const registro = await service.obtenerParaEditar(req.params.id);
    if (!registro) {
      return res.redirect(
        `/laboratorio.html?error=no-encontrado&id=${encodeURIComponent(req.params.id)}`,
      );
    }
    const [catalogo, doctores] = await Promise.all([
      service.catalogoParaFormulario(),
      service.listarDoctoresActivos(),
    ]);
    const permissions = req.session.user.permissions ?? [];
    const csrfToken = generateCsrfToken(req, res);
    res.render('laboratorio-form', {
      registro,
      doctorIdPreseleccionado: null,
      soloLectura: forzarSoloLectura || !permissions.includes('laboratorio.editar'),
      modoCargarArchivos: Boolean(modoCargarArchivos),
      catalogo,
      doctores,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function editarForm(req, res, next) {
  return formularioDeRegistro(req, res, next, {
    forzarSoloLectura: false,
    modoCargarArchivos: false,
  });
}

async function verForm(req, res, next) {
  return formularioDeRegistro(req, res, next, {
    forzarSoloLectura: true,
    modoCargarArchivos: false,
  });
}

async function cargarForm(req, res, next) {
  return formularioDeRegistro(req, res, next, {
    forzarSoloLectura: true,
    modoCargarArchivos: true,
  });
}

async function buscarTutor(req, res, next) {
  try {
    const tutor = await service.resolverTutorPorTelefono(req.body.telefono);
    res.json(tutor ? { existe: true, tutor } : { existe: false });
  } catch (err) {
    next(err);
  }
}

async function buscarTutorPorNombre(req, res, next) {
  try {
    const tutores = await service.buscarTutoresPorNombre(req.body.q);
    res.json({ tutores });
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    const id = await service.crear({ ...req.body, usuarioId: req.session.user.id });
    res.status(201).json({ id, redirectTo: 'laboratorio.html' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function editar(req, res, next) {
  try {
    await service.editar(req.params.id, { ...req.body, usuarioId: req.session.user.id });
    res.json({ redirectTo: 'laboratorio.html' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function subirArchivoRegistro(req, res, next) {
  try {
    const resultado = await service.subirArchivoParaTodos(
      req.params.id,
      req.files,
      req.session.user.id,
    );
    res.json({ ok: true, reutilizado: resultado.reutilizado });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function subirArchivoEstudio(req, res, next) {
  try {
    const resultado = await service.subirArchivoParaEstudio(
      req.params.id,
      req.params.estudioId,
      req.files,
      req.session.user.id,
    );
    res.json({ ok: true, reutilizado: resultado.reutilizado });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function eliminarArchivoRegistro(req, res, next) {
  try {
    await service.eliminarArchivoDeTodos(req.params.id, req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function eliminarArchivoEstudio(req, res, next) {
  try {
    await service.eliminarArchivoDeEstudio(
      req.params.id,
      req.params.estudioId,
      req.session.user.id,
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function enviarResultados(req, res, next) {
  try {
    const resultado = await service.enviarResultados(req.params.id, req.session.user.id);
    res.json(resultado);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function descargarArchivo(req, res, next) {
  try {
    const archivo = await service.obtenerArchivoParaDescarga(req.params.archivoId);
    if (!archivo || !fs.existsSync(archivo.rutaAbsoluta)) {
      return res.status(404).send('Archivo no encontrado');
    }
    res.download(archivo.rutaAbsoluta, archivo.nombreOriginal);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  pagina,
  filter,
  eliminar,
  nuevoForm,
  editarForm,
  verForm,
  cargarForm,
  buscarTutor,
  buscarTutorPorNombre,
  crear,
  editar,
  subirArchivoRegistro,
  subirArchivoEstudio,
  eliminarArchivoRegistro,
  eliminarArchivoEstudio,
  enviarResultados,
  descargarArchivo,
};
