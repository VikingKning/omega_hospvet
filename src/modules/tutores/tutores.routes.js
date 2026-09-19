const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./tutores.controller');

const router = express.Router();

router.get(
  '/tutores.html',
  requireAuth,
  requirePermission('tutores.ver'),
  attachSidebarAreas,
  controller.list,
);

router.post(
  '/tutores.html',
  requireAuth,
  requirePermission('tutores.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

router.get(
  '/tutores/nuevo',
  requireAuth,
  requirePermission('tutores.crear'),
  attachSidebarAreas,
  controller.nuevoForm,
);
router.get(
  '/tutores/:id/editar',
  requireAuth,
  requirePermission('tutores.editar'),
  attachSidebarAreas,
  controller.editarForm,
);
router.get(
  '/tutores/:id/ver',
  requireAuth,
  requirePermission('tutores.ver'),
  attachSidebarAreas,
  controller.verForm,
);

router.post(
  '/tutores/buscar-telefono',
  requireAuth,
  requirePermission('tutores.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTelefono,
);

router.post(
  '/tutores/buscar-mascota',
  requireAuth,
  requirePermission((req) => `agenda.${req.body.slug}.crear`),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarMascota,
);

router.post(
  '/tutores/buscar-tutor-telefono',
  requireAuth,
  requirePermission((req) => `agenda.${req.body.slug}.crear`),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTutorTelefono,
);
router.post(
  '/tutores/buscar-tutor-nombre',
  requireAuth,
  requirePermission((req) => `agenda.${req.body.slug}.crear`),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTutorNombre,
);

router.post(
  '/tutores/verificar-telefono',
  requireAuth,
  requirePermission('tutores.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.verificarTelefono,
);

router.post(
  '/tutores',
  requireAuth,
  requirePermission('tutores.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/tutores/:id',
  requireAuth,
  requirePermission('tutores.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

router.delete(
  '/tutores/:id',
  requireAuth,
  requirePermission('tutores.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

module.exports = router;
