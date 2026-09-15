const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const writeLimiter = require('../../middlewares/writeLimiter');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./whatsapp.alertas.controller');

const router = express.Router();

router.get('/api/whatsapp/alertas', requireAuth, controller.listar);
router.get('/api/whatsapp/alertas/eventos', requireAuth, controller.eventosSse);
router.post(
  '/api/whatsapp/alertas/:id/navegador',
  requireAuth,
  writeLimiter,
  doubleCsrfProtection,
  controller.registrarNavegador,
);
router.post(
  '/api/whatsapp/alertas/:id/atender',
  requireAuth,
  writeLimiter,
  doubleCsrfProtection,
  controller.atender,
);

module.exports = router;
