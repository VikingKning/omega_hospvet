const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./areas.controller');

const router = express.Router();

router.get('/areas.html', requireAuth, requirePermission('areas.ver'), controller.list);

// Filtro/orden/paginación vía HTMX: nunca aparece en la URL ni en el
// historial del navegador (mismo criterio de privacidad que doctores.html).
router.post(
  '/areas.html',
  requireAuth,
  requirePermission('areas.ver'),
  doubleCsrfProtection,
  controller.filter,
);

// US-611: baja lógica de un área, disparada por HTMX desde el ícono de
// eliminar del listado (con confirmación previa vía hx-confirm).
router.delete(
  '/areas/:id',
  requireAuth,
  requirePermission('areas.eliminar'),
  doubleCsrfProtection,
  controller.desactivar,
);

// US-610: alta y edición, mismo formulario en un modal. Los GET solo arman
// el fragmento del formulario (vacío o precargado); los POST/PUT hacen el
// alta/edición real.
router.get('/areas/nuevo', requireAuth, requirePermission('areas.crear'), controller.nuevoForm);
router.get(
  '/areas/:id/editar',
  requireAuth,
  requirePermission('areas.editar'),
  controller.editarForm,
);
router.post(
  '/areas',
  requireAuth,
  requirePermission('areas.crear'),
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/areas/:id',
  requireAuth,
  requirePermission('areas.editar'),
  doubleCsrfProtection,
  controller.editar,
);

module.exports = router;
