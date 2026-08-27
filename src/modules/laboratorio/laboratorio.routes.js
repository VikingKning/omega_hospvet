const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./laboratorio.controller');

const router = express.Router();

router.get(
  '/laboratorio.html',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.pagina,
);

// Filtro/orden/paginación vía HTMX — mismo criterio de privacidad que
// doctores.routes.js (nunca en la URL/historial, protegido con CSRF real).
router.post(
  '/laboratorio.html',
  requireAuth,
  requirePermission('laboratorio.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

// Pedido explícito del usuario: alta/edición/consulta son pantallas
// completas propias (mismo patrón que tutores.routes.js), no un modal — por
// eso llevan attachSidebarAreas (arman el layout completo con sidebar,
// igual que /tutores/nuevo).
router.get(
  '/laboratorio/nuevo',
  requireAuth,
  requirePermission('laboratorio.crear'),
  attachSidebarAreas,
  controller.nuevoForm,
);

// Consulta y edición viven en la MISMA ruta (pedido explícito del usuario):
// el controller decide `soloLectura` según si el usuario también tiene
// laboratorio.editar — laboratorio.ver alcanza para abrir la pantalla.
router.get(
  '/laboratorio/:id/editar',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.editarForm,
);

// Ícono de "ojo" nuevo en la tabla — pedido explícito del usuario: alguien
// con permiso de editar también puede querer solo CONSULTAR un registro sin
// riesgo de tocarlo. Misma pantalla que /editar, mismo permiso mínimo
// (`laboratorio.ver`), pero el controller siempre fuerza soloLectura=true
// sin importar si el usuario también tiene laboratorio.editar.
router.get(
  '/laboratorio/:id/ver',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.verForm,
);

router.post(
  '/laboratorio/buscar-tutor',
  requireAuth,
  requirePermission('laboratorio.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTutor,
);

// Pedido explícito del usuario: buscar tutor por nombre para cuando no se
// sabe su teléfono — mismo permiso que buscar-tutor (solo se usa en Nuevo
// registro).
router.post(
  '/laboratorio/buscar-tutor-nombre',
  requireAuth,
  requirePermission('laboratorio.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTutorPorNombre,
);

router.post(
  '/laboratorio',
  requireAuth,
  requirePermission('laboratorio.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);

router.put(
  '/laboratorio/:id',
  requireAuth,
  requirePermission('laboratorio.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

// Baja lógica de una orden, disparada por HTMX desde el ícono de eliminar
// del listado (con confirmación previa vía hx-confirm, mismo patrón que
// doctores.routes.js).
router.delete(
  '/laboratorio/:id',
  requireAuth,
  requirePermission('laboratorio.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.eliminar,
);

module.exports = router;
