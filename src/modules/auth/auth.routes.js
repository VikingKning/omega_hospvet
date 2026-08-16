const express = require('express');
const validate = require('../../middlewares/validate');
const requireAuth = require('../../middlewares/requireAuth');
const writeLimiter = require('../../middlewares/writeLimiter');
const { doubleCsrfProtection } = require('../../config/csrf');
const { loginSchema, cambiarPasswordSchema } = require('./auth.schema');
const controller = require('./auth.controller');

const router = express.Router();

// Formulario que modifica estado (crea sesión): protegido con CSRF (documento
// de Arquitectura y Buenas Prácticas, sección 7). La limitación de intentos
// fallidos (express-rate-limit) es US-106, no de esta historia.
router.post('/login', doubleCsrfProtection, validate(loginSchema), controller.login);
router.get('/logout', controller.logout);

// US-605: pantalla del cambio obligatorio de contraseña. Requiere sesión
// (requireAuth), sin requirePermission — cualquier usuario autenticado,
// sin importar sus permisos, necesita poder llegar a su propia pantalla de
// cambio obligatorio (una sesión restringida por mustChangePassword no
// tiene permisos reales, ver auth.service.js#login). requireAuth.js ya
// exime estas dos rutas de su propio redirect-a-cambiar-password, así que
// no hay bucle.
router.get('/cambiar-password', requireAuth, controller.cambiarPasswordForm);
router.post(
  '/cambiar-password',
  requireAuth,
  writeLimiter,
  doubleCsrfProtection,
  validate(cambiarPasswordSchema, 'La contraseña y su confirmación son obligatorias.'),
  controller.cambiarPassword,
);

module.exports = router;
