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
const requirePermission = require('./middlewares/requirePermission');
const attachSidebarAreas = require('./middlewares/attachSidebarAreas');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const doctoresRoutes = require('./modules/doctores/doctores.routes');
const areasRoutes = require('./modules/areas/areas.routes');
const plantillasRoutes = require('./modules/plantillas_whatsapp/plantillas_whatsapp.routes');
const usuariosRoutes = require('./modules/usuarios/usuarios.routes');
const perfilRoutes = require('./modules/perfil/perfil.routes');

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
// Genera un nonce único por request para el CSP (script-src) — permite los
// <script> propios del proyecto (inline y js/htmx.min.js) sin necesitar
// 'unsafe-inline'. Tiene que registrarse ANTES de helmet(): la directiva
// script-src de abajo lee res.locals.cspNonce vía una función (req, res) =>
// ..., que helmet invoca al construir el header — el valor ya tiene que
// existir en res.locals para ese momento.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      // useDefaults:false: se prefiere una política explícita y completa a
      // heredar en silencio los defaults de helmet (que incluyen
      // style-src 'unsafe-inline', innecesario aquí — cero CSS inline en
      // todo el proyecto, confirmado).
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        scriptSrcAttr: ["'none'"], // refuerza: cero onclick=/onerror=/etc. en el proyecto
        // 'unsafe-inline' aquí no es un descuido: no hay CSS en atributos
        // style="" ni <style> en ningún .ejs (verificado), pero el CLIENTE
        // sí hace `elemento.style.top = ...`/`.left =`/`.width = ...` en
        // varios lugares (posicionamiento de los combobox flotantes en
        // usuarios.ejs/doctores.ejs/laboratorio.ejs, animaciones del
        // sidebar, semáforo de citas). Eso pasa por el mismo mecanismo de
        // "estilo inline" que un style="" en el HTML — un CSP style-src sin
        // 'unsafe-inline' lo bloquea igual, y a diferencia de script-src no
        // hay forma práctica de darle un nonce a un valor que se calcula en
        // tiempo real (ej. la posición de un rect). Es el mismo trade-off
        // que usan la mayoría de los CSP nonce-based en producción: el
        // riesgo real de XSS vive en script-src (ejecución arbitraria),
        // no en style-src (a lo sumo permite maquetar/ocultar contenido).
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"], // HTMX (selfRequestsOnly) solo pega al mismo origen
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // agenda.ejs/grooming.ejs embeben un iframe de Google Calendar
        // (mockup actual, ver Bitácora — FullCalendar lo reemplazará).
        frameSrc: ["'self'", 'https://calendar.google.com'],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
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

// Mensaje específico por motivo de expiración — texto exacto de cada AC
// (US-108 para inactividad, US-111 para el tope absoluto de 8h);
// `expirarSesion` en requireAuth.js manda el motivo exacto en
// `?expired=<motivo>`.
const EXPIRED_MESSAGES = {
  inactividad: 'La sesión expiró por inactividad. Favor de iniciar sesión nuevamente.',
  absoluto: 'Tu sesión ha expirado. Favor de iniciar sesión nuevamente.',
};

app.get(['/', '/index.html'], (req, res) => {
  if (req.session.user) {
    return res.redirect('/main.html');
  }

  // Se toca la sesión para forzar que se guarde (saveUninitialized:false no
  // la persiste sola) y así el id de sesión usado para firmar el token CSRF
  // en este GET sea el mismo que llegue de vuelta en el POST /login.
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

// Cada módulo del sidebar se protege con requireAuth (sesión válida) y
// requirePermission (el permiso sembrado exactamente para este módulo en
// US-000) — así una URL directa no puede saltarse lo que el menú ya oculta
// (AC6 de US-101: nunca confiar en que el frontend oculte el acceso).
//
// Reconstrucción del menú (mismo día que sidebar.ejs pasa a listar agendas
// por área): agenda.html/grooming.html ya NO se protegen con los permisos
// planos legacy `agenda.ver`/`grooming.ver` (siguen en el catálogo pero
// nunca se exponen en la matriz de permisos desde US-604 — ver migración
// 20260817000001), sino con los granulares `agenda.<slug>.ver` que sí son
// asignables (el módulo de cada permiso en el catálogo es `agenda_<slug>`,
// con guion bajo, pero su `codigo` real usado en sesión/requirePermission
// lleva punto: `agenda.<slug>.ver`). agenda.html combina en una sola página
// las áreas Consultas y
// Cirugías, así que basta con tener visibilidad de CUALQUIERA de las dos
// (requirePermission soporta un array con semántica OR).
const modulePages = [
  { route: 'agenda', view: 'agenda', permission: ['agenda.consultas.ver', 'agenda.cirugias.ver'] },
  { route: 'grooming', view: 'grooming', permission: 'agenda.grooming.ver' },
  { route: 'laboratorio', view: 'laboratorio', permission: 'laboratorio.ver' },
];

for (const { route, view, permission } of modulePages) {
  app.get(
    `/${route}.html`,
    requireAuth,
    requirePermission(permission),
    attachSidebarAreas,
    (req, res) => res.render(view, { user: req.session.user }),
  );
}

app.use('/', authRoutes);
app.use('/', doctoresRoutes);
app.use('/', areasRoutes);
app.use('/', plantillasRoutes);
app.use('/', usuariosRoutes);
app.use('/', perfilRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
