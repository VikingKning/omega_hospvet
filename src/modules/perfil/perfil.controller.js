const service = require('./perfil.service');
const { generateCsrfToken } = require('../../config/csrf');

function datosDeCuenta(perfil) {
  return {
    estatus: perfil.estatus,
    ultimoLoginEn: perfil.ultimo_login_en ?? null,
    doctor: perfil.doctor ?? null,
    areasDoctor: perfil.areasDoctor ?? [],
    matrizPermisos: perfil.matrizPermisos ?? { tabs: [] },
    permisosAsignadosIds: perfil.permisosAsignadosIds ?? [],
  };
}

async function mostrarForm(req, res, next) {
  try {
    const perfil = await service.obtener(req.session.user.id);
    const csrfToken = generateCsrfToken(req, res);
    res.render('perfil', {
      nombre: perfil.nombre,
      apellidos: perfil.apellidos,
      telefono: perfil.telefono ?? '',
      correo: perfil.correo,
      username: perfil.username,
      avatar: perfil.avatar,
      avataresDisponibles: service.AVATARES_VALIDOS,
      ...datosDeCuenta(perfil),
      mensaje: null,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function actualizar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const guardado = await service.actualizar(req.session.user.id, {
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      telefono: req.body.telefono,
      correo: req.body.correo,
      avatar: req.body.avatar,
    });

    req.session.user.nombre = guardado.nombre;
    req.session.user.apellidos = guardado.apellidos;
    req.session.user.avatar = guardado.avatar;

    const perfil = await service.obtener(req.session.user.id);
    return res.render('partials/perfil-form', {
      nombre: guardado.nombre,
      apellidos: guardado.apellidos,
      telefono: guardado.telefono ?? '',
      correo: guardado.correo,
      username: req.session.user.username,
      avatar: guardado.avatar,
      avataresDisponibles: service.AVATARES_VALIDOS,
      ...datosDeCuenta(perfil),
      mensaje: 'Perfil actualizado correctamente.',
      error: null,
      csrfToken,
    });
  } catch (err) {
    if (err.status) {
      const perfil = await service.obtener(req.session.user.id);
      return res.render('partials/perfil-form', {
        nombre: req.body.nombre ?? '',
        apellidos: req.body.apellidos ?? '',
        telefono: req.body.telefono ?? '',
        correo: req.body.correo ?? '',
        username: req.session.user.username,
        avatar: req.body.avatar ?? perfil.avatar,
        avataresDisponibles: service.AVATARES_VALIDOS,
        ...datosDeCuenta(perfil),
        mensaje: null,
        error: err.message,
        csrfToken,
      });
    }
    return next(err);
  }
}

async function cambiarPassword(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.cambiarPassword(req.session.user.id, {
      passwordActual: req.body.passwordActual,
      passwordNueva: req.body.passwordNueva,
      confirmarPassword: req.body.confirmarPassword,
    });

    return res.render('partials/perfil-password-form', {
      mensaje: 'Contraseña actualizada correctamente.',
      error: null,
      csrfToken,
    });
  } catch (err) {
    if (err.status) {
      return res.render('partials/perfil-password-form', {
        mensaje: null,
        error: err.message,
        csrfToken,
      });
    }
    return next(err);
  }
}

module.exports = { mostrarForm, actualizar, cambiarPassword };
