const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const env = require('./env');

const PgSession = connectPgSimple(session);

// Política de sesión (Decisión 4 de la bitácora, corregida v4): 30 minutos de
// inactividad con renovación por actividad ("rolling"). El tope absoluto de
// 8-12 horas se valida aparte, en requireAuth.js, porque express-session no
// impone por sí solo un máximo independiente del rolling.
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

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
    maxAge: THIRTY_MINUTES_MS,
  },
});

// `store` se expone para poder cerrarlo explícitamente (store.close()) al
// terminar los tests de integración: connect-pg-simple corre un
// setInterval interno para podar sesiones expiradas que, si no se limpia,
// deja el proceso de Node colgado esperando ese timer.
module.exports = { middleware, store };
