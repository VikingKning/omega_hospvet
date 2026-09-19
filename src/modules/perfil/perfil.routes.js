const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./perfil.controller');

const router = express.Router();

router.get('/mi-perfil.html', requireAuth, attachSidebarAreas, controller.mostrarForm);
router.post(
  '/mi-perfil.html',
  requireAuth,
  writeLimiter,
  doubleCsrfProtection,
  controller.actualizar,
);

router.post(
  '/mi-perfil/password',
  requireAuth,
  writeLimiter,
  doubleCsrfProtection,
  controller.cambiarPassword,
);

module.exports = router;
