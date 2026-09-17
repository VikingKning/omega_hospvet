const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const hxRedirect = require('../../middlewares/hxRedirect');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./usuarios.controller');

const router = express.Router();

function requirePermisosSiSePresenta(req, res, next) {
  if (req.body.permisosSeccion === undefined) return next();
  const permissions = req.session.user?.permissions ?? [];
  if (!permissions.includes('usuarios.permisos')) {
    return hxRedirect(req, res, '/main.html');
  }
  return next();
}

router.get(
  '/usuarios.html',
  requireAuth,
  requirePermission('usuarios.ver'),
  attachSidebarAreas,
  controller.list,
);

router.post(
  '/usuarios.html',
  requireAuth,
  requirePermission('usuarios.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

router.delete(
  '/usuarios/:id',
  requireAuth,
  requirePermission('usuarios.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.darDeBaja,
);

router.post(
  '/usuarios/:id/resetear-password',
  requireAuth,
  requirePermission('usuarios.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.resetearPassword,
);

router.get(
  '/usuarios/nuevo',
  requireAuth,
  requirePermission('usuarios.crear'),
  controller.nuevoForm,
);
router.get(
  '/usuarios/:id/editar',
  requireAuth,
  requirePermission('usuarios.editar'),
  controller.editarForm,
);
router.get('/usuarios/:id/ver', requireAuth, requirePermission('usuarios.ver'), controller.verForm);
router.post(
  '/usuarios/username-sugerido',
  requireAuth,
  requirePermission('usuarios.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.sugerirUsername,
);
router.post(
  '/usuarios',
  requireAuth,
  requirePermission('usuarios.crear'),
  requirePermisosSiSePresenta,
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/usuarios/:id',
  requireAuth,
  requirePermission('usuarios.editar'),
  requirePermisosSiSePresenta,
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

module.exports = router;
