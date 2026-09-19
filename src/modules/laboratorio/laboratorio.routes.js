const express = require('express');
const multer = require('multer');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./laboratorio.controller');

const router = express.Router();

const uploadArchivos = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
    fields: 0,
    parts: 10,
    fieldArrayIndexLimit: 0,
  },
});

const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: 'El archivo es demasiado grande (máximo 50MB).',
  LIMIT_FILE_COUNT: 'Puedes subir máximo 10 archivos a la vez.',
  LIMIT_FIELD_COUNT: 'La carga no admite campos de texto adicionales.',
  LIMIT_PART_COUNT: 'La carga contiene demasiadas partes.',
  INVALID_FIELD_NAME: 'La carga contiene un nombre de campo no válido.',
};

function subirArchivos(req, res, next) {
  uploadArchivos.array('archivos')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      err.status = 400;
      err.message = MULTER_ERROR_MESSAGES[err.code] || err.message;
    }
    next(err);
  });
}

router.get(
  '/laboratorio.html',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.pagina,
);

router.post(
  '/laboratorio.html',
  requireAuth,
  requirePermission('laboratorio.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

router.get(
  '/laboratorio/nuevo',
  requireAuth,
  requirePermission('laboratorio.crear'),
  attachSidebarAreas,
  controller.nuevoForm,
);

router.get(
  '/laboratorio/:id/editar',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.editarForm,
);

router.get(
  '/laboratorio/:id/ver',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.verForm,
);

router.get(
  '/laboratorio/:id/cargar',
  requireAuth,
  requirePermission('laboratorio.cargar'),
  attachSidebarAreas,
  controller.cargarForm,
);

router.post(
  '/laboratorio/buscar-tutor',
  requireAuth,
  requirePermission('laboratorio.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTutor,
);

router.post(
  '/laboratorio/buscar-tutor-nombre',
  requireAuth,
  requirePermission('laboratorio.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTutorPorNombre,
);

router.post(
  '/laboratorio',
  requireAuth,
  requirePermission('laboratorio.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);

router.put(
  '/laboratorio/:id',
  requireAuth,
  requirePermission('laboratorio.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

router.post(
  '/laboratorio/:id/archivos',
  requireAuth,
  requirePermission('laboratorio.cargar'),
  writeLimiter,
  doubleCsrfProtection,
  subirArchivos,
  controller.subirArchivoRegistro,
);

router.post(
  '/laboratorio/:id/estudios/:estudioId/archivo',
  requireAuth,
  requirePermission('laboratorio.cargar'),
  writeLimiter,
  doubleCsrfProtection,
  subirArchivos,
  controller.subirArchivoEstudio,
);

router.delete(
  '/laboratorio/:id/archivos',
  requireAuth,
  requirePermission('laboratorio.cargar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.eliminarArchivoRegistro,
);

router.delete(
  '/laboratorio/:id/estudios/:estudioId/archivo',
  requireAuth,
  requirePermission('laboratorio.cargar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.eliminarArchivoEstudio,
);

router.post(
  '/laboratorio/:id/preparar-envio',
  requireAuth,
  requirePermission('laboratorio.enviar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.prepararEnvioResultados,
);

router.post(
  '/laboratorio/:id/enviar',
  requireAuth,
  requirePermission('laboratorio.enviar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.enviarResultados,
);

router.get(
  '/laboratorio/archivos/:archivoId',
  requireAuth,
  requirePermission('laboratorio.ver'),
  controller.descargarArchivo,
);

router.delete(
  '/laboratorio/:id',
  requireAuth,
  requirePermission('laboratorio.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.eliminar,
);

module.exports = router;
