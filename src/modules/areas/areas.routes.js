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

module.exports = router;
