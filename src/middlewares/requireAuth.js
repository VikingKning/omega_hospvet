// Tope absoluto de sesión (Decisión 4 de la bitácora, corregida v4): 8-12
// horas independientemente de la actividad. express-session solo resuelve el
// rolling de 30 min (ver config/session.js); este máximo se valida aquí.
const ABSOLUTE_SESSION_MAX_MS = 10 * 60 * 60 * 1000; // 10h, dentro del rango 8-12h

function requireAuth(req, res, next) {
  // Nunca cachear una pantalla protegida: sin esto, el botón "Atrás" del
  // navegador puede mostrar una copia guardada en bfcache después de cerrar
  // sesión, sin volver a pedirle nada al servidor — se vería la pantalla
  // aunque la sesión ya no exista (AC2 de US-107).
  res.set('Cache-Control', 'no-store');

  const { user, loginAt } = req.session;

  if (!user || !loginAt) {
    return res.redirect('/');
  }

  if (Date.now() - loginAt > ABSOLUTE_SESSION_MAX_MS) {
    return req.session.destroy(() => {
      res.clearCookie('omega.sid');
      res.redirect('/?expired=1');
    });
  }

  next();
}

module.exports = requireAuth;
