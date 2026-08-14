const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');

const logger = require('./config/logger');
const { middleware: sessionMiddleware } = require('./config/session');
const { generateCsrfToken } = require('./config/csrf');
const requireAuth = require('./middlewares/requireAuth');
const requirePermission = require('./middlewares/requirePermission');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const doctoresRoutes = require('./modules/doctores/doctores.routes');
const areasRoutes = require('./modules/areas/areas.routes');
const plantillasRoutes = require('./modules/plantillas_whatsapp/plantillas_whatsapp.routes');
const usuariosRoutes = require('./modules/usuarios/usuarios.routes');

const rootDir = path.join(__dirname, '..');
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  pinoHttp({
    logger,
    // Decisión cerrada (Arquitectura y Buenas Prácticas, sección 4.3): pino-http
    // solo registra fallos (4xx/5xx), nunca cada petición exitosa — evita
    // consumir disco innecesario en el servidor de recursos limitados de la
    // clínica (Decisión 9).
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'silent';
    },
  }),
);
app.use(
  helmet({
    // Las vistas EJS migradas del PoC usan <script> inline sin nonces (menú,
    // combobox de laboratorio, semáforo de citas, etc). El CSP por defecto de
    // helmet bloquearía ese JS. Se desactiva hasta que ese JS se extraiga a
    // archivos separados y se pueda habilitar un CSP real.
    contentSecurityPolicy: false,
  }),
);
app.use(compression());
app.use(express.json());
// HTMX manda el <form> del panel de doctores con la codificación por
// defecto de un form HTML (application/x-www-form-urlencoded), no JSON —
// express.json() no lo parsea, hace falta este middleware aparte.
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(rootDir, 'public')));
app.use(cookieParser());
app.use(sessionMiddleware);

app.get(['/', '/index.html'], (req, res) => {
  if (req.session.user) {
    return res.redirect('/main.html');
  }

  // Se toca la sesión para forzar que se guarde (saveUninitialized:false no
  // la persiste sola) y así el id de sesión usado para firmar el token CSRF
  // en este GET sea el mismo que llegue de vuelta en el POST /login.
  req.session.csrfInitialized = true;
  const csrfToken = generateCsrfToken(req, res);
  res.render('index', { csrfToken, expired: req.query.expired === '1' });
});

app.get('/main.html', requireAuth, (req, res) => {
  res.render('main', { user: req.session.user });
});

// Cada módulo del sidebar se protege con requireAuth (sesión válida) y
// requirePermission (el permiso sembrado exactamente para este módulo en
// US-000) — así una URL directa no puede saltarse lo que el menú ya oculta
// (AC6 de US-101: nunca confiar en que el frontend oculte el acceso).
const modulePages = [
  { route: 'agenda', view: 'agenda', permission: 'agenda.ver' },
  { route: 'grooming', view: 'grooming', permission: 'grooming.ver' },
  { route: 'laboratorio', view: 'laboratorio', permission: 'laboratorio.ver' },
];

for (const { route, view, permission } of modulePages) {
  app.get(`/${route}.html`, requireAuth, requirePermission(permission), (req, res) =>
    res.render(view, { user: req.session.user }),
  );
}

app.use('/', authRoutes);
app.use('/', doctoresRoutes);
app.use('/', areasRoutes);
app.use('/', plantillasRoutes);
app.use('/', usuariosRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
