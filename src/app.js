const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');

const logger = require('./config/logger');
const { middleware: sessionMiddleware } = require('./config/session');
const { generateCsrfToken } = require('./config/csrf');
const requireAuth = require('./middlewares/requireAuth');
const attachSidebarAreas = require('./middlewares/attachSidebarAreas');
const sanitizeBody = require('./middlewares/sanitizeBody');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const doctoresRoutes = require('./modules/doctores/doctores.routes');
const areasRoutes = require('./modules/areas/areas.routes');
const plantillasRoutes = require('./modules/plantillas_whatsapp/plantillas_whatsapp.routes');
const usuariosRoutes = require('./modules/usuarios/usuarios.routes');
const perfilRoutes = require('./modules/perfil/perfil.routes');
const tutoresRoutes = require('./modules/tutores/tutores.routes');
const agendaRoutes = require('./modules/agenda/agenda.routes');
const laboratorioRoutes = require('./modules/laboratorio/laboratorio.routes');
const metricasRoutes = require('./modules/metricas/metricas.routes');
const whatsappRoutes = require('./modules/whatsapp/whatsapp.routes');
const whatsappAlertasRoutes = require('./modules/whatsapp/whatsapp.alertas.routes');

const rootDir = path.join(__dirname, '..');
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'silent';
    },
  }),
);
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        scriptSrcAttr: ["'none'"], // refuerza: cero onclick=/onerror=/etc. en el proyecto
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], // HTMX (selfRequestsOnly) solo pega al mismo origen
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameSrc: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
  }),
);
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});
app.use(compression());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));
app.use(sanitizeBody);
app.use(express.static(path.join(rootDir, 'public')));
app.use(cookieParser());
app.use(sessionMiddleware);

const EXPIRED_MESSAGES = {
  inactividad: 'La sesión expiró por inactividad. Favor de iniciar sesión nuevamente.',
  absoluto: 'Tu sesión ha expirado. Favor de iniciar sesión nuevamente.',
};

app.get(['/', '/index.html'], (req, res) => {
  if (req.session.user) {
    return res.redirect('/main.html');
  }

  req.session.csrfInitialized = true;
  const csrfToken = generateCsrfToken(req, res);
  res.render('index', {
    csrfToken,
    expiredMessage: EXPIRED_MESSAGES[req.query.expired] ?? null,
  });
});

app.get('/main.html', requireAuth, attachSidebarAreas, (req, res) => {
  res.render('main', { user: req.session.user });
});


app.use('/', authRoutes);
app.use('/', doctoresRoutes);
app.use('/', areasRoutes);
app.use('/', plantillasRoutes);
app.use('/', usuariosRoutes);
app.use('/', perfilRoutes);
app.use('/', tutoresRoutes);
app.use('/', agendaRoutes);
app.use('/', laboratorioRoutes);
app.use('/', metricasRoutes);
app.use('/', whatsappAlertasRoutes);
app.use('/', whatsappRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
