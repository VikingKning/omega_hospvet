const authService = require('./auth.service');
const { generateCsrfToken } = require('../../config/csrf');

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const user = await authService.login(username, password);

    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = user;
      req.session.loginAt = Date.now();
      req.session.lastActivityAt = Date.now();
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
