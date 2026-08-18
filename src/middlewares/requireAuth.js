const hxRedirect = require('./hxRedirect');

// Tope absoluto de sesión — US-111 lo fija en exactamente 8 horas desde el
// login (AC1/AC2: "registra la fecha y hora de inicio... para calcular su
// límite absoluto"), dentro del rango 8-12h que ya dejaba abierto la
// Decisión 4 de la bitácora, corregida v4. Corre independientemente de la
// actividad (AC2: "independientemente de las peticiones o acciones
// realizadas") — nunca se reinicia por actividad, a diferencia de
// `lastActivityAt` de abajo (AC3). express-session solo resuelve el rolling
// de 30 min (ver config/session.js); este máximo se valida aquí.
const ABSOLUTE_SESSION_MAX_MS = 8 * 60 * 60 * 1000; // 8h (US-111)

// US-108 AC: 30 minutos de INACTIVIDAD (distinto del tope absoluto de
// arriba, que corre independientemente de qué tan activo esté el usuario).
// `config/session.js` importa este mismo valor para el `cookie.maxAge` del
// tope absoluto (ver ese archivo) — la fila de `session` en Postgres vive
// hasta 8h, mucho más que estos 30 min, a propósito: si el chequeo de
// abajo dependiera de que la propia cookie/fila expirara sola a los 30 min,
// para cuando el usuario regresara después de estar inactivo la sesión ya
// no existiría en absoluto (ni la cookie ni la fila), y no habría forma de
// distinguir "la sesión expiró por inactividad" de "nunca hubo sesión" para
// mostrar el mensaje específico del AC — por eso la fila se deja vivir más
// tiempo y es ESTE código, no el vencimiento físico de la cookie/fila, el
// que decide y aplica la regla de negocio real (AC: "el sistema debe
// considerarlo expirado" aunque el registro todavía exista físicamente
// pendiente de limpieza por connect-pg-simple).
const INACTIVITY_MAX_MS = 30 * 60 * 1000;

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

// Destruye la sesión y redirige a login con un motivo — hxRedirect ya
// resuelve HTMX vs. navegación normal (AC de US-108/US-111: fetch/HTMX/
// navegación completa deben rechazarse todos igual); `motivo` decide qué
// mensaje muestra index.ejs (app.js#EXPIRED_MESSAGES).
function expirarSesion(req, res, motivo) {
  return req.session.destroy(() => {
    res.clearCookie('omega.sid');
    hxRedirect(req, res, `/?expired=${motivo}`);
  });
}

function requireAuth(req, res, next) {
  // Nunca cachear una pantalla protegida: sin esto, el botón "Atrás" del
  // navegador puede mostrar una copia guardada en bfcache después de cerrar
  // sesión, sin volver a pedirle nada al servidor — se vería la pantalla
  // aunque la sesión ya no exista (AC2 de US-107).
  res.set('Cache-Control', 'no-store');

  const { user, loginAt, lastActivityAt } = req.session;

  if (!user || !loginAt) {
    return hxRedirect(req, res, '/');
  }

  // US-111 AC7/AC8/AC9: cualquiera de los dos límites que se cumpla primero
  // expira la sesión — este chequeo va antes que el de inactividad de abajo
  // nada más por orden de lectura, no porque tenga prioridad real: si ambos
  // se cumplieran a la vez (imposible en la práctica, uno siempre ocurre
  // antes que el otro dado que INACTIVITY_MAX_MS < ABSOLUTE_SESSION_MAX_MS),
  // de todos modos ninguna de las dos peticiones subsecuentes tendría éxito.
  if (Date.now() - loginAt > ABSOLUTE_SESSION_MAX_MS) {
    return expirarSesion(req, res, 'absoluto');
  }

  // US-108 AC: "ventana móvil de 30 min desde la última actividad válida".
  // `lastActivityAt` se fija en el login (auth.controller.js) y se renueva
  // aquí mismo, al final, en CADA petición autenticada que pasa todos los
  // demás gates — así cualquier navegación, consulta, guardado o acción
  // reinicia la ventana (AC), y como vive en la misma fila de `session` que
  // usa el resto de pestañas con la misma cookie, la actividad de una
  // pestaña renueva la ventana para todas (AC de multi-pestaña). Nunca toca
  // `loginAt` (US-111 AC3: la actividad "únicamente reinicia el contador de
  // inactividad" — el tope absoluto de arriba es ajeno a esto).
  if (lastActivityAt && Date.now() - lastActivityAt > INACTIVITY_MAX_MS) {
    return expirarSesion(req, res, 'inactividad');
  }

  if (user.mustChangePassword && !RUTAS_EXENTAS_CAMBIO_PASSWORD.includes(req.path)) {
    return hxRedirect(req, res, '/cambiar-password');
  }

  req.session.lastActivityAt = Date.now();
  next();
}

module.exports = requireAuth;
module.exports.ABSOLUTE_SESSION_MAX_MS = ABSOLUTE_SESSION_MAX_MS;
module.exports.INACTIVITY_MAX_MS = INACTIVITY_MAX_MS;
