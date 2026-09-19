const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./agenda.controller');

const router = express.Router();


router.get(
  '/agenda/:slug.html',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.ver`),
  attachSidebarAreas,
  controller.attachArea,
  controller.pagina,
);

router.get(
  '/agenda/:slug/citas.json',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.ver`),
  controller.attachArea,
  controller.eventos,
);

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

router.delete(
  '/agenda/:slug/citas/:id',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.cancelar`),
  writeLimiter,
  doubleCsrfProtection,
  controller.attachArea,
  controller.cancelar,
);

router.post(
  '/agenda/:slug/citas/:id/confirmar',
  requireAuth,
  requirePermission((req) => `agenda.${req.params.slug}.editar`),
  writeLimiter,
  doubleCsrfProtection,
  controller.attachArea,
  controller.confirmar,
);

module.exports = router;
