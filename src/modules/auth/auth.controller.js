const authService = require('./auth.service');
const { generateCsrfToken } = require('../../config/csrf');

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const user = await authService.login(username, password);

    // Se regenera el id de sesión al autenticar (previene session fixation):
    // un id de sesión emitido antes del login nunca debe quedar válido
    // después de escalar privilegios.
    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = user;
      req.session.loginAt = Date.now();
      // US-108: arranca la ventana móvil de 30 min de inactividad — sin
      // esto, requireAuth.js vería `lastActivityAt` undefined en la
      // primera petición tras el login y (por diseño, para no rechazar de
      // más) no aplicaría el chequeo hasta la primera vez que sí exista;
      // fijarlo aquí asegura que la ventana ya está corriendo desde el
      // login mismo, no desde la siguiente petición.
      req.session.lastActivityAt = Date.now();
      // US-605: user.mustChangePassword solo viene en true cuando
      // authService.login() resolvió una sesión restringida (estatus
      // cambio_pwd con la temporal correcta) — requireAuth.js confina esa
      // sesión a /cambiar-password sin importar a dónde redirija el
      // cliente, pero se manda el destino correcto de una vez para no
      // depender de un rebote.
      res.json({ redirectTo: user.mustChangePassword ? '/cambiar-password' : '/main.html' });
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('omega.sid');
    res.redirect('/');
  });
}

// US-605: pantalla del cambio obligatorio — requireAuth.js ya garantiza que
// solo llega aquí una sesión válida (restringida o no); no hace falta
// re-chequear mustChangePassword en el controller.
function cambiarPasswordForm(req, res) {
  const csrfToken = generateCsrfToken(req, res);
  res.render('cambiar-password', { csrfToken });
}

async function cambiarPassword(req, res, next) {
  try {
    const permissions = await authService.cambiarPasswordObligatorio(
      req.session.user.id,
      req.body.password,
      req.body.confirmacion,
    );
    // Misma sesión, sin re-login (decidido explícitamente): se actualiza in
    // situ con los permisos reales (la sesión restringida se creó con
    // permissions:[]) y se quita la marca — requireAuth.js deja de
    // confinarla a partir de esta misma request.
    req.session.user.permissions = permissions;
    delete req.session.user.mustChangePassword;
    res.json({ redirectTo: '/main.html' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

module.exports = { login, logout, cambiarPasswordForm, cambiarPassword };
