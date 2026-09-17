const express = require('express');
const controller = require('./whatsapp.controller');

const router = express.Router();

router.get('/webhooks/whatsapp', controller.verificar);
router.post('/webhooks/whatsapp', controller.recibir);

module.exports = router;
