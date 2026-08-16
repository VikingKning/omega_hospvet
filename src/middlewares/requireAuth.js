const hxRedirect = require('./hxRedirect');

// Tope absoluto de sesión (Decisión 4 de la bitácora, corregida v4): 8-12
// horas independientemente de la actividad. express-session solo resuelve el
// rolling de 30 min (ver config/session.js); este máximo se valida aquí.
const ABSOLUTE_SESSION_MAX_MS = 10 * 60 * 60 * 1000; // 10h, dentro del rango 8-12h

// US-605: una sesión con mustChangePassword=true (creada por
// auth.service.js#login cuando estatus='cambio_pwd' y la temporal fue
// correcta) no puede tocar NADA del sistema salvo completar su propio
// cambio de contraseña o cerrar sesión — AC explícito: "rechaza el acceso
// y lo mantiene dentro del flujo obligatorio". Se resuelve aquí, en
// requireAuth, en vez de un middleware aparte que habría que recordar
// agregar a cada ruta protegida una por una (y con certeza olvidar en
// alguna futura) — requireAuth ya es el único punto por el que pasan
// TODAS las rutas protegidas del sistema, así que es el lugar donde este
// gate no se puede saltar por descuido. Comparado contra req.path (no
// req.originalUrl): ambas rutas están montadas en la raíz de la app
// (app.use('/', authRoutes)), así que coincide exacto con lo que
// registran esas dos rutas en auth.routes.js.
const RUTAS_EXENTAS_CAMBIO_PASSWORD = ['/cambiar-password', '/logout'];

function requireAuth(req, res, next) {
  // Nunca cachear una pantalla protegida: sin esto, el botón "Atrás" del
  // navegador puede mostrar una copia guardada en bfcache después de cerrar
  // sesión, sin volver a pedirle nada al servidor — se vería la pantalla
  // aunque la sesión ya no exista (AC2 de US-107).
  res.set('Cache-Control', 'no-store');

  const { user, loginAt } = req.session;

  if (!user || !loginAt) {
    return hxRedirect(req, res, '/');
  }

  if (Date.now() - loginAt > ABSOLUTE_SESSION_MAX_MS) {
    return req.session.destroy(() => {
      res.clearCookie('omega.sid');
      hxRedirect(req, res, '/?expired=1');
    });
  }

  if (user.mustChangePassword && !RUTAS_EXENTAS_CAMBIO_PASSWORD.includes(req.path)) {
    return hxRedirect(req, res, '/cambiar-password');
  }

  next();
}

module.exports = requireAuth;
