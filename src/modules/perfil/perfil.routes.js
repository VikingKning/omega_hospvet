const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./perfil.controller');

const router = express.Router();

// US-109 AC: "Permiso requerido: Ninguno. La funcionalidad está
// disponible para cualquier usuario autenticado" — a diferencia de TODAS
// las demás páginas del panel, aquí solo se exige `requireAuth`, sin
// `requirePermission`. Una sesión restringida por US-605
// (mustChangePassword=true) SIGUE sin poder llegar aquí — requireAuth.js
// solo exime /cambiar-password y /logout, "Mi perfil" cuenta como
// cualquier otra funcionalidad de la que esa sesión debe quedar fuera
// hasta completar el cambio obligatorio.
router.get('/mi-perfil.html', requireAuth, attachSidebarAreas, controller.mostrarForm);
router.post(
  '/mi-perfil.html',
  requireAuth,
  writeLimiter,
  doubleCsrfProtection,
  controller.actualizar,
);

// US-110: acción separada de /mi-perfil.html (no una ruta ".html", es una
// acción, mismo criterio que /usuarios/:id/resetear-password de US-605) —
// re-renderiza solo su propio fragmento (partials/perfil-password-form),
// nunca la página completa.
router.post(
  '/mi-perfil/password',
  requireAuth,
  writeLimiter,
  doubleCsrfProtection,
  controller.cambiarPassword,
);

module.exports = router;
