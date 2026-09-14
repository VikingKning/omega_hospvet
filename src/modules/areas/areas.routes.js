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

// Filtro/orden/paginación vía HTMX: nunca aparece en la URL ni en el
// historial del navegador (mismo criterio de privacidad que doctores.html).
router.post(
  '/areas.html',
  requireAuth,
  requirePermission('areas.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

// US-611: baja lógica de un área, disparada por HTMX desde el ícono de
// eliminar del listado (con confirmación previa vía hx-confirm).
router.delete(
  '/areas/:id',
  requireAuth,
  requirePermission('areas.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

// Pedido explícito del usuario: contraparte de la baja de arriba, para las
// áreas predeterminadas del sistema (Consultas/Estética) que no son
// editables y por lo tanto solo pueden volver a activo por aquí. Mismo
// permiso que la baja (areas.eliminar: "puede cambiar el estado activo de
// un área", el mismo vocabulario ya usado por ese código).
router.put(
  '/areas/:id/activar',
  requireAuth,
  requirePermission('areas.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.activar,
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
// Pedido explícito del usuario: fragmento de solo-lectura para las áreas
// predeterminadas del sistema — mismo permiso que el listado (areas.ver),
// no areas.editar (nunca van a poder editar desde aquí).
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
