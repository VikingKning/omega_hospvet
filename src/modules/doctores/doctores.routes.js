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

// Filtro/orden/paginación vía HTMX: nunca aparece en la URL ni en el
// historial del navegador (motivo: privacidad de lo que se busca). El body
// viaja igual de "sucio" que un query string, así que se protege con el
// mismo CSRF que POST /login — no es un GET disfrazado.
router.post(
  '/doctores.html',
  requireAuth,
  requirePermission('doctores.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

// US-608: baja lógica de un doctor, disparada por HTMX desde el ícono de
// eliminar del listado (con confirmación previa vía hx-confirm).
router.delete(
  '/doctores/:id',
  requireAuth,
  requirePermission('doctores.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

// US-607: alta y edición, mismo formulario en un modal (mismo patrón que
// areas.routes.js/US-610). Los GET solo arman el fragmento del formulario
// (vacío o precargado); los POST/PUT hacen el alta/edición real. Cada ruta
// exige el permiso específico de la acción (crear ≠ editar) — así un
// usuario con uno solo de los dos nunca puede ejecutar el otro, aunque el
// formulario sea visualmente el mismo.
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
