const express = require('express');
const multer = require('multer');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./laboratorio.controller');

const router = express.Router();

// Memoria (no disco directo): laboratorio.archivos.js necesita el Buffer
// completo en memoria de todos modos para poder fusionar varios archivos
// en un PDF antes de escribir el resultado final — guardarlos primero en
// disco solo para releerlos sería trabajo doble. Límites generosos pero
// acotados (un panel interno de una sola clínica, no una API pública):
// 50MB por archivo (video de consultorio), máximo 10 archivos por lote.
const uploadArchivos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
});

// MulterError no trae `.status` — sin este wrapper, un archivo demasiado
// grande caería al 500 genérico de errorHandler.js en vez de un 400 con un
// mensaje que el usuario pueda entender.
const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: 'El archivo es demasiado grande (máximo 50MB).',
  LIMIT_FILE_COUNT: 'Puedes subir máximo 10 archivos a la vez.',
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

// Filtro/orden/paginación vía HTMX — mismo criterio de privacidad que
// doctores.routes.js (nunca en la URL/historial, protegido con CSRF real).
router.post(
  '/laboratorio.html',
  requireAuth,
  requirePermission('laboratorio.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

// Pedido explícito del usuario: alta/edición/consulta son pantallas
// completas propias (mismo patrón que tutores.routes.js), no un modal — por
// eso llevan attachSidebarAreas (arman el layout completo con sidebar,
// igual que /tutores/nuevo).
router.get(
  '/laboratorio/nuevo',
  requireAuth,
  requirePermission('laboratorio.crear'),
  attachSidebarAreas,
  controller.nuevoForm,
);

// Consulta y edición viven en la MISMA ruta (pedido explícito del usuario):
// el controller decide `soloLectura` según si el usuario también tiene
// laboratorio.editar — laboratorio.ver alcanza para abrir la pantalla.
router.get(
  '/laboratorio/:id/editar',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.editarForm,
);

// Ícono de "ojo" nuevo en la tabla — pedido explícito del usuario: alguien
// con permiso de editar también puede querer solo CONSULTAR un registro sin
// riesgo de tocarlo. Misma pantalla que /editar, mismo permiso mínimo
// (`laboratorio.ver`), pero el controller siempre fuerza soloLectura=true
// sin importar si el usuario también tiene laboratorio.editar. PURAMENTE
// informativa — corrección explícita del usuario: nunca ofrece subir
// archivos, eso vive en /cargar (ver abajo).
router.get(
  '/laboratorio/:id/ver',
  requireAuth,
  requirePermission('laboratorio.ver'),
  attachSidebarAreas,
  controller.verForm,
);

// Ícono "Subir resultados" de la tabla — pedido explícito del usuario:
// pantalla similar a /ver pero con los controles de carga de archivos.
// Permiso propio (`laboratorio.cargar`, no laboratorio.ver): alguien que
// solo puede cargar resultados no necesariamente tiene por qué poder abrir
// /ver ni /editar.
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

// Pedido explícito del usuario: buscar tutor por nombre para cuando no se
// sabe su teléfono — mismo permiso que buscar-tutor (solo se usa en Nuevo
// registro).
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

// Carga de archivos de resultados (pedido explícito del usuario) — solo
// desde la pantalla "Ver" (soloLectura), gateado por laboratorio.cargar
// (permiso ya sembrado, sin usar hasta ahora). `subirArchivos` ANTES de
// doubleCsrfProtection también funcionaría (el token viaja en un header,
// no en el body), pero se deja DESPUÉS a propósito: así el CSRF se valida
// antes de gastar tiempo/memoria procesando archivos de una petición que
// de todos modos se iba a rechazar.
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

// Quitar un archivo ya cargado (pedido explícito del usuario: "por si se
// equivocó el usuario") — mismo permiso que subir, sin multer (no llevan
// body).
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

// Descarga autenticada — laboratorio.ver alcanza (igual que abrir la
// pantalla de consulta), no hace falta laboratorio.cargar para poder ver
// un resultado ya cargado.
router.get(
  '/laboratorio/archivos/:archivoId',
  requireAuth,
  requirePermission('laboratorio.ver'),
  controller.descargarArchivo,
);

// Baja lógica de una orden, disparada por HTMX desde el ícono de eliminar
// del listado (con confirmación previa vía hx-confirm, mismo patrón que
// doctores.routes.js).
router.delete(
  '/laboratorio/:id',
  requireAuth,
  requirePermission('laboratorio.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.eliminar,
);

module.exports = router;
