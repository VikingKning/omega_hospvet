const authService = require('./auth.service');

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
      res.json({ redirectTo: '/main.html' });
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

module.exports = { login, logout };
