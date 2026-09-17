const service = require('./usuarios.service');
const { generateCsrfToken } = require('../../config/csrf');

async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('usuarios', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuarios-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

async function darDeBaja(req, res, next) {
  try {
    let error = null;
    try {
      await service.darDeBaja(req.params.id, req.session.user.id);
    } catch (err) {
      if (!err.status) throw err;
      error = err.message;
    }
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuarios-panel', { ...data, user: req.session.user, csrfToken, error });
  } catch (err) {
    next(err);
  }
}

async function resetearPassword(req, res, next) {
  try {
    let error = null;
    let passwordTemporal = null;
    try {
      passwordTemporal = await service.resetearPassword(req.params.id, req.session.user.id);
      if (!passwordTemporal) {
        error = 'No se pudo restablecer la contraseña: el usuario ya no existe.';
      }
    } catch (err) {
      if (!err.status) throw err;
      error = err.message;
    }
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    if (passwordTemporal) {
      res.set(
        'HX-Trigger',
        JSON.stringify({ mostrarPasswordTemporal: { password: passwordTemporal } }),
      );
    }
    res.render('partials/usuarios-panel', { ...data, user: req.session.user, csrfToken, error });
  } catch (err) {
    next(err);
  }
}

async function nuevoForm(req, res, next) {
  try {
    const [doctoresDisponibles, catalogoPermisos, areasParaPermisos] = await Promise.all([
      service.listDoctoresDisponibles(),
      service.obtenerCatalogoPermisos(),
      service.listAreasParaPermisos(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuario-form', {
      usuario: null,
      nombre: '',
      apellidos: '',
      correo: '',
      telefono: '',
      username: '',
      estatus: 'activo',
      tipoUsuario: 'usuario',
      notificacionesAlertas: false,
      doctorSeleccionado: null,
      doctoresDisponibles,
      matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
      permisosAsignadosIds: [],
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
    const usuario = await service.obtener(req.params.id);
    if (!usuario) {
      return res.status(404).send('Usuario no encontrado');
    }
    const [catalogoPermisos, permisosAsignadosIds, areasParaPermisos] = await Promise.all([
      service.obtenerCatalogoPermisos(),
      service.permisosAsignadosDe(usuario.id),
      service.listAreasParaPermisos(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuario-form', {
      usuario,
      nombre: usuario.nombre,
      apellidos: usuario.apellidos,
      correo: usuario.correo,
      telefono: usuario.telefono ?? '',
      username: usuario.username,
      estatus: usuario.estatus,
      tipoUsuario: usuario.doctor_id ? 'doctor' : usuario.tipo_usuario,
      notificacionesAlertas: usuario.notificaciones_alertas,
      doctorSeleccionado: usuario.doctor ?? null,
      doctoresDisponibles: [],
      matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
      permisosAsignadosIds,
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
    const usuario = await service.obtener(req.params.id);
    if (!usuario) {
      return res.status(404).send('Usuario no encontrado');
    }
    const [catalogoPermisos, permisosAsignadosIds, areasParaPermisos] = await Promise.all([
      service.obtenerCatalogoPermisos(),
      service.permisosAsignadosDe(usuario.id),
      service.listAreasParaPermisos(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuario-form', {
      usuario,
      nombre: usuario.nombre,
      apellidos: usuario.apellidos,
      correo: usuario.correo,
      telefono: usuario.telefono ?? '',
      username: usuario.username,
      estatus: usuario.estatus,
      tipoUsuario: usuario.doctor_id ? 'doctor' : usuario.tipo_usuario,
      notificacionesAlertas: usuario.notificaciones_alertas,
      doctorSeleccionado: usuario.doctor ?? null,
      doctoresDisponibles: [],
      matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
      permisosAsignadosIds,
      soloLectura: true,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function sugerirUsername(req, res, next) {
  try {
    const username = await service.sugerirUsername(req.body.nombre, req.body.apellidos);
    res.json({ username });
  } catch (err) {
    next(err);
  }
}

async function renderExito(req, res, next, csrfToken) {
  try {
    const data = await service.list({});
    res.set('HX-Trigger', 'closeUsuarioModal');
    res.render('partials/usuarios-panel-oob', { ...data, user: req.session.user, csrfToken });
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
      correo: req.body.correo,
      telefono: req.body.telefono,
      username: req.body.username,
      password: req.body.password,
      doctorId: req.body.doctorId,
      tipoUsuario: req.body.tipoUsuario,
      notificacionesAlertas: req.body.notificacionesAlertas,
      permisos: req.body.permisos,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      const [doctoresDisponibles, doctorSeleccionado, catalogoPermisos, areasParaPermisos] =
        await Promise.all([
          service.listDoctoresDisponibles(),
          service.resolverDoctor(req.body.doctorId),
          service.obtenerCatalogoPermisos(),
          service.listAreasParaPermisos(),
        ]);
      return res.render('partials/usuario-form', {
        usuario: null,
        nombre: req.body.nombre ?? '',
        apellidos: req.body.apellidos ?? '',
        correo: req.body.correo ?? '',
        telefono: req.body.telefono ?? '',
        username: err.usernameSugerido ?? req.body.username ?? '',
        estatus: 'activo',
        tipoUsuario: service.parseTipoUsuario(req.body.tipoUsuario, doctorSeleccionado?.id),
        notificacionesAlertas: service.parseBooleanCheckbox(req.body.notificacionesAlertas),
        doctorSeleccionado: doctorSeleccionado ?? null,
        doctoresDisponibles,
        matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
        permisosAsignadosIds: service.parsePermissionIds(req.body.permisos),
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
      return res.status(404).send('Usuario no encontrado');
    }

    const permisosProvistos = req.body.permisosSeccion !== undefined;

    try {
      await service.editar({
        id: req.params.id,
        nombre: req.body.nombre,
        apellidos: req.body.apellidos,
        correo: req.body.correo,
        telefono: req.body.telefono,
        username: req.body.username,
        estatus: req.body.estatus,
        tipoUsuario: req.body.tipoUsuario,
        notificacionesAlertas: req.body.notificacionesAlertas,
        permisos: req.body.permisos,
        permisosProvistos,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        const [catalogoPermisos, permisosActuales, areasParaPermisos] = await Promise.all([
          service.obtenerCatalogoPermisos(),
          service.permisosAsignadosDe(existing.id),
          service.listAreasParaPermisos(),
        ]);
        return res.render('partials/usuario-form', {
          usuario: existing,
          nombre: req.body.nombre ?? '',
          apellidos: req.body.apellidos ?? '',
          correo: req.body.correo ?? '',
          telefono: req.body.telefono ?? '',
          username: err.usernameSugerido ?? req.body.username ?? '',
          estatus: req.body.estatus ?? existing.estatus,
          tipoUsuario: existing.doctor_id
            ? 'doctor'
            : service.parseTipoUsuario(req.body.tipoUsuario, null),
          notificacionesAlertas: service.parseBooleanCheckbox(req.body.notificacionesAlertas),
          doctorSeleccionado: existing.doctor ?? null,
          doctoresDisponibles: [],
          matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
          permisosAsignadosIds: permisosProvistos
            ? service.parsePermissionIds(req.body.permisos)
            : permisosActuales,
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
  darDeBaja,
  resetearPassword,
  nuevoForm,
  editarForm,
  verForm,
  sugerirUsername,
  crear,
  editar,
};
