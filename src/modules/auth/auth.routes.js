const express = require('express');
const validate = require('../../middlewares/validate');
const { doubleCsrfProtection } = require('../../config/csrf');
const { loginSchema } = require('./auth.schema');
const controller = require('./auth.controller');

const router = express.Router();

// Formulario que modifica estado (crea sesión): protegido con CSRF (documento
// de Arquitectura y Buenas Prácticas, sección 7). La limitación de intentos
// fallidos (express-rate-limit) es US-106, no de esta historia.
router.post('/login', doubleCsrfProtection, validate(loginSchema), controller.login);
router.get('/logout', controller.logout);

module.exports = router;
