const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./doctores.controller');

const router = express.Router();

router.get(
  '/doctores.html',
  requireAuth,
  requirePermission('doctores.ver'),
  attachSidebarAreas,
  controller.list,
);

router.post(
  '/doctores.html',
  requireAuth,
  requirePermission('doctores.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

router.delete(
  '/doctores/:id',
  requireAuth,
  requirePermission('doctores.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

router.get(
  '/doctores/nuevo',
  requireAuth,
  requirePermission('doctores.crear'),
  controller.nuevoForm,
);
router.get(
  '/doctores/:id/editar',
  requireAuth,
  requirePermission('doctores.editar'),
  controller.editarForm,
);
router.get('/doctores/:id/ver', requireAuth, requirePermission('doctores.ver'), controller.verForm);
router.post(
  '/doctores',
  requireAuth,
  requirePermission('doctores.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/doctores/:id',
  requireAuth,
  requirePermission('doctores.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

module.exports = router;
