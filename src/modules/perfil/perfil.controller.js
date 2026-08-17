const service = require('./perfil.service');
const { generateCsrfToken } = require('../../config/csrf');

// Datos ligados a la cuenta (doctor/especialidades/permisos, más
// estatus/último acceso para la tarjeta "Mi cuenta") — de solo lectura,
// nunca cambian por un guardado de datos personales, pero viven dentro de
// #perfil-panel (el swap target de HTMX), así que tienen que viajar en LOS
// TRES render() de este archivo para no desaparecer de la pantalla tras
// guardar o tras un error de validación.
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

// US-109 AC: "identifica al usuario exclusivamente a partir de la sesión
// autenticada" — el id SIEMPRE sale de req.session.user.id, nunca de
// req.params/req.query/req.body. No hay ninguna otra forma de llegar a
// esta función con un id distinto: ni la ruta ni el formulario aceptan uno.
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

// US-109 AC: fragmento HTMX — actualiza y re-renderiza solo el formulario
// (con el mensaje de éxito o de error), sin recargar la página completa.
async function actualizar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const guardado = await service.actualizar(req.session.user.id, {
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      telefono: req.body.telefono,
      correo: req.body.correo,
    });

    // Mantiene la sesión en sincronía — evita que el resto de la app siga
    // mostrando el nombre/apellidos viejos hasta el próximo login (hoy
    // ninguna otra pantalla los muestra, pero req.session.user es la
    // fuente que usaría cualquier futura que sí lo haga).
    req.session.user.nombre = guardado.nombre;
    req.session.user.apellidos = guardado.apellidos;

    const perfil = await service.obtener(req.session.user.id);
    return res.render('partials/perfil-form', {
      nombre: guardado.nombre,
      apellidos: guardado.apellidos,
      telefono: guardado.telefono ?? '',
      correo: guardado.correo,
      username: req.session.user.username,
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
        ...datosDeCuenta(perfil),
        mensaje: null,
        error: err.message,
        csrfToken,
      });
    }
    return next(err);
  }
}

// US-110: fragmento HTMX independiente del resto de la página — solo
// re-renderiza la sección "Cambiar contraseña" (partials/perfil-password-form,
// swap sobre #cambiar-password-panel, ver perfil-form.ejs), no todo
// #perfil-panel. No hay razón para volver a consultar doctor/áreas/matriz
// de permisos por un cambio que no los toca, y mantiene el <details> de esa
// sección abierto (su innerHTML se reemplaza, el propio <details> no).
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
