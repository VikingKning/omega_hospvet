const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const env = require('./env');
const { ABSOLUTE_SESSION_MAX_MS } = require('../middlewares/requireAuth');

const PgSession = connectPgSimple(session);

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

module.exports = { middleware, store };
