const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./areas.controller');

const router = express.Router();

router.get(
  '/areas.html',
  requireAuth,
  requirePermission('areas.ver'),
  attachSidebarAreas,
  controller.list,
);

router.post(
  '/areas.html',
  requireAuth,
  requirePermission('areas.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

router.delete(
  '/areas/:id',
  requireAuth,
  requirePermission('areas.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

router.put(
  '/areas/:id/activar',
  requireAuth,
  requirePermission('areas.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.activar,
);

router.get('/areas/nuevo', requireAuth, requirePermission('areas.crear'), controller.nuevoForm);
router.get(
  '/areas/:id/editar',
  requireAuth,
  requirePermission('areas.editar'),
  controller.editarForm,
);
router.get('/areas/:id/ver', requireAuth, requirePermission('areas.ver'), controller.verForm);
router.post(
  '/areas',
  requireAuth,
  requirePermission('areas.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/areas/:id',
  requireAuth,
  requirePermission('areas.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

module.exports = router;
