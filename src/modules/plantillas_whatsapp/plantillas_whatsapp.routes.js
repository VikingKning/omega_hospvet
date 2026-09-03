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

// Filtro/orden/paginación vía HTMX: nunca aparece en la URL ni en el
// historial del navegador (mismo criterio de privacidad que
// doctores.html/areas.html). El body viaja igual de "sucio" que un query
// string, así que se protege con el mismo CSRF que POST /login.
router.post(
  '/plantillas.html',
  requireAuth,
  requirePermission('plantillas.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

// US-614: baja lógica de una plantilla, disparada por HTMX desde el ícono
// de eliminar del listado (con confirmación previa vía hx-confirm).
router.delete(
  '/plantillas/:id',
  requireAuth,
  requirePermission('plantillas.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

// US-613: alta y edición, mismo formulario en un modal. Los GET solo arman
// el fragmento del formulario (vacío o precargado); los POST/PUT hacen el
// alta/edición real. Cada ruta exige el permiso específico de la acción
// (crear ≠ editar) — así un usuario con uno solo de los dos nunca puede
// ejecutar el otro, aunque el formulario sea visualmente el mismo.
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
// Ícono "Ver": solo lectura, gate plantillas.ver (a diferencia de editar
// arriba) — quien solo puede consultar el catálogo también puede abrir el
// detalle completo de una plantilla, sin poder modificarla.
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
