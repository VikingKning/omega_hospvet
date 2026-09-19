const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./plantillas_whatsapp.controller');

const router = express.Router();

router.get(
  '/plantillas.html',
  requireAuth,
  requirePermission('plantillas.ver'),
  attachSidebarAreas,
  controller.list,
);

router.post(
  '/plantillas.html',
  requireAuth,
  requirePermission('plantillas.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

router.delete(
  '/plantillas/:id',
  requireAuth,
  requirePermission('plantillas.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

router.get(
  '/plantillas/nuevo',
  requireAuth,
  requirePermission('plantillas.crear'),
  controller.nuevoForm,
);
router.get(
  '/plantillas/:id/editar',
  requireAuth,
  requirePermission('plantillas.editar'),
  controller.editarForm,
);
router.get(
  '/plantillas/:id/ver',
  requireAuth,
  requirePermission('plantillas.ver'),
  controller.verForm,
);
router.post(
  '/plantillas',
  requireAuth,
  requirePermission('plantillas.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/plantillas/:id',
  requireAuth,
  requirePermission('plantillas.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

module.exports = router;
