const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');

const logger = require('./config/logger');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

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
app.use(express.static(path.join(rootDir, 'public')));

app.get(['/', '/index.html'], (req, res) => res.render('index'));

const pages = ['main', 'agenda', 'grooming', 'laboratorio'];
for (const page of pages) {
  app.get(`/${page}.html`, (req, res) => res.render(page));
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
