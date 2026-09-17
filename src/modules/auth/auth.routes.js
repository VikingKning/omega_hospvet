const express = require('express');
const validate = require('../../middlewares/validate');
const requireAuth = require('../../middlewares/requireAuth');
const writeLimiter = require('../../middlewares/writeLimiter');
const { doubleCsrfProtection } = require('../../config/csrf');
const { loginSchema, cambiarPasswordSchema } = require('./auth.schema');
const controller = require('./auth.controller');

const router = express.Router();

router.post('/login', doubleCsrfProtection, validate(loginSchema), controller.login);
router.get('/logout', controller.logout);

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
