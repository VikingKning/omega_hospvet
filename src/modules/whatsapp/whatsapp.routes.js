// Callback externo de Meta, nunca una acción de un usuario con sesión — sin
// requireAuth/CSRF (ver comentario en app.js). Protegido por el
// verify_token (GET) y la firma HMAC (POST) en su lugar.
const express = require('express');
const controller = require('./whatsapp.controller');

const router = express.Router();

router.get('/webhooks/whatsapp', controller.verificar);
router.post('/webhooks/whatsapp', controller.recibir);

module.exports = router;
