const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./usuarios.controller');

const router = express.Router();

router.get('/usuarios.html', requireAuth, requirePermission('usuarios.ver'), controller.list);

// Filtro/orden/paginación vía HTMX: nunca aparece en la URL ni en el
// historial del navegador (mismo criterio de privacidad que
// doctores.html/areas.html/plantillas.html). El body viaja igual de
// "sucio" que un query string, así que se protege con el mismo CSRF que
// POST /login.
router.post(
  '/usuarios.html',
  requireAuth,
  requirePermission('usuarios.ver'),
  doubleCsrfProtection,
  controller.filter,
);

// US-602 (alta/edición), US-603 (baja), US-604 (permisos) y US-605
// (reseteo de contraseña) agregarán aquí sus rutas de escritura — por
// ahora este listado es solo lectura (AC de US-601: los botones/acciones
// de crear/editar/permisos/resetear/eliminar son decorativos, gateados
// por permiso, sin funcionalidad real todavía).

module.exports = router;
