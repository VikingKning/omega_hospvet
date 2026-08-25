const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./agenda.controller');

const router = express.Router();

// El permiso depende del área de la URL (`agenda.<slug>.<accion>`), que no
// existe todavía cuando se arma este router — por eso `requirePermission`
// recibe una función `(req) => código`, evaluada en cada request (ver
// requirePermission.js). `attachArea` resuelve `:slug` contra un área
// real/activa (404 si no) DESPUÉS del permiso, nunca antes — mismo orden
// que areas.routes.js (requireAuth -> requirePermission -> lo demás).

// GET /agenda/:slug.html — página completa del calendario.
router.get(
  '/agenda/:slug.html',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.ver`),
  attachSidebarAreas,
  controller.attachArea,
  controller.pagina,
);

// Feed de FullCalendar — mismo permiso que la página (solo lectura).
router.get(
  '/agenda/:slug/citas.json',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.ver`),
  controller.attachArea,
  controller.eventos,
);

// Bloques "ocupado" del doctor filtrado en OTRAS áreas (sin detalle, solo
// para pintarlos en gris) — pedido explícito del usuario. Mismo permiso de
// solo lectura que el feed de arriba.
router.get(
  '/agenda/:slug/citas/ocupado.json',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.ver`),
  controller.attachArea,
  controller.ocupado,
);

router.get(
  '/agenda/:slug/citas/nueva',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.crear`),
  controller.attachArea,
  controller.nuevoForm,
);

router.get(
  '/agenda/:slug/citas/:id/editar',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.editar`),
  controller.attachArea,
  controller.editarForm,
);

router.post(
  '/agenda/:slug/citas',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.crear`),
  writeLimiter,
  doubleCsrfProtection,
  controller.attachArea,
  controller.crear,
);

router.put(
  '/agenda/:slug/citas/:id',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.editar`),
  writeLimiter,
  doubleCsrfProtection,
  controller.attachArea,
  controller.editar,
);

// "Eliminar" en la UI es cancelar (baja lógica) — mismo permiso que
// cancelar/dar de baja en el resto del sistema.
router.delete(
  '/agenda/:slug/citas/:id',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.cancelar`),
  writeLimiter,
  doubleCsrfProtection,
  controller.attachArea,
  controller.cancelar,
);

module.exports = router;
