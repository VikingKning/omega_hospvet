const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./doctores.controller');

const router = express.Router();

router.get('/doctores.html', requireAuth, requirePermission('doctores.ver'), controller.list);

// Filtro/orden/paginación vía HTMX: nunca aparece en la URL ni en el
// historial del navegador (motivo: privacidad de lo que se busca). El body
// viaja igual de "sucio" que un query string, así que se protege con el
// mismo CSRF que POST /login — no es un GET disfrazado.
router.post(
  '/doctores.html',
  requireAuth,
  requirePermission('doctores.ver'),
  doubleCsrfProtection,
  controller.filter,
);

module.exports = router;
