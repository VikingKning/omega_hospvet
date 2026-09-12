const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./metricas.controller');

const router = express.Router();

router.get(
  '/metricas/laboratorio.html',
  requireAuth,
  requirePermission('metricas.laboratorios.ver'),
  attachSidebarAreas,
  controller.pagina,
);

// Filtro de rango de fechas vía HTMX — mismo criterio de privacidad que
// laboratorio.routes.js/doctores.routes.js (nunca en la URL/historial,
// protegido con el mismo CSRF real que un POST de escritura aunque este
// módulo sea 100% lectura).
router.post(
  '/metricas/laboratorio.html',
  requireAuth,
  requirePermission('metricas.laboratorios.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

router.get(
  '/metricas/agenda.html',
  requireAuth,
  requirePermission('metricas.agenda.ver'),
  attachSidebarAreas,
  controller.paginaAgenda,
);

router.post(
  '/metricas/agenda.html',
  requireAuth,
  requirePermission('metricas.agenda.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filterAgenda,
);

router.get(
  '/metricas/whatsapp.html',
  requireAuth,
  requirePermission('metricas.whatsapp.ver'),
  attachSidebarAreas,
  controller.paginaWhatsapp,
);

router.post(
  '/metricas/whatsapp.html',
  requireAuth,
  requirePermission('metricas.whatsapp.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filterWhatsapp,
);

module.exports = router;
