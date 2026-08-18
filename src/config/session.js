const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const env = require('./env');
const { ABSOLUTE_SESSION_MAX_MS } = require('../middlewares/requireAuth');

const PgSession = connectPgSimple(session);

// Política de sesión: 30 minutos de inactividad con renovación por actividad
// ("rolling", US-108), tope absoluto de 8h (US-111, dentro del rango 8-12h
// que dejaba abierto la Decisión 4 de la bitácora). Ambas reglas de negocio
// las aplica requireAuth.js explícitamente (`lastActivityAt`/`loginAt`), no
// solo el vencimiento físico de la cookie — así que `cookie.maxAge` aquí NO
// es el mecanismo de los 30 minutos (US-108 AC: "el sistema debe
// considerarlo expirado" aunque la fila de `session` siga existiendo
// físicamente pendiente de limpieza). Se fija al mismo techo que el tope
// absoluto: la fila tiene que sobrevivir en Postgres al menos hasta que
// requireAuth pueda leerla y decidir por su cuenta que ya expiró (por los
// 30 min de inactividad, o por las 8h absolutas) — si la cookie/fila
// muriera sola a los 30 min, un usuario que regresa después de estar
// inactivo llegaría con una sesión ya inexistente (sin `lastActivityAt` que
// leer), y el sistema no podría distinguir "expiró por inactividad" de
// "nunca inició sesión" para mostrar el mensaje específico del AC.
const store = new PgSession({
  conObject: env.db,
  tableName: 'session',
  createTableIfMissing: false,
});

const middleware = session({
  store,
  name: 'omega.sid',
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: ABSOLUTE_SESSION_MAX_MS,
  },
});

// `store` se expone para poder cerrarlo explícitamente (store.close()) al
// terminar los tests de integración: connect-pg-simple corre un
// setInterval interno para podar sesiones expiradas que, si no se limpia,
// deja el proceso de Node colgado esperando ese timer.
module.exports = { middleware, store };
