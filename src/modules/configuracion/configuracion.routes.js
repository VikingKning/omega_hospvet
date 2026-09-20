const express = require('express');
const multer = require('multer');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./configuracion.controller');

const router = express.Router();

const uploadAviso = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
});

const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: 'El archivo es demasiado grande (máximo 10MB).',
  LIMIT_FILE_COUNT: 'Solo puedes subir un archivo.',
};

function subirAviso(req, res, next) {
  uploadAviso.single('archivo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      err.status = 400;
      err.message = MULTER_ERROR_MESSAGES[err.code] || err.message;
    }
    next(err);
  });
}

router.get(
  '/configuracion/generales.html',
  requireAuth,
  requirePermission('configuracion.editar'),
  attachSidebarAreas,
  controller.mostrarForm,
);

router.get(
  '/configuracion/generales/archivo-existente',
  requireAuth,
  requirePermission('configuracion.editar'),
  controller.verificarArchivoExistente,
);

router.post(
  '/configuracion/generales.html',
  requireAuth,
  requirePermission('configuracion.editar'),
  writeLimiter,
  doubleCsrfProtection,
  subirAviso,
  controller.guardarAviso,
);

module.exports = router;
