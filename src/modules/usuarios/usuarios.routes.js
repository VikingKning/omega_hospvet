const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const hxRedirect = require('../../middlewares/hxRedirect');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./usuarios.controller');

const router = express.Router();

// US-604 AC: "intento modificar permisos sin contar con usuarios.permisos
// ... el sistema rechaza el cambio aunque el usuario tenga usuarios.crear o
// usuarios.editar". El apartado de Permisos vive en el MISMO formulario/
// ruta que los datos generales (US-602) — no hay una ruta propia de
// "permisos" a la que colgarle un requirePermission('usuarios.permisos')
// normal. Este middleware cubre exactamente ese hueco: solo actúa cuando el
// body trae el marcador `permisosSeccion` (el cliente intentó tocar la
// matriz — desde el formulario real, o directamente contra el servidor) y
// en ese caso exige el permiso específico, sin importar que la ruta ya haya
// pasado el gate de usuarios.crear/usuarios.editar. Mismo criterio de
// respuesta que requirePermission.js (hxRedirect a /main.html).
function requirePermisosSiSePresenta(req, res, next) {
  if (req.body.permisosSeccion === undefined) return next();
  const permissions = req.session.user?.permissions ?? [];
  if (!permissions.includes('usuarios.permisos')) {
    return hxRedirect(req, res, '/main.html');
  }
  return next();
}

router.get('/usuarios.html', requireAuth, requirePermission('usuarios.ver'), controller.list);

// Filtro/orden/paginación vía HTMX: nunca aparece en la URL ni en el
// historial del navegador (mismo criterio de privacidad que
// doctores.html/areas.html/plantillas.html). El body viaja igual de
// "sucio" que un query string, así que se protege con el mismo CSRF que
// POST /login.
router.post(
  '/usuarios.html',
  requireAuth,
  requirePermission('usuarios.ver'),
  doubleCsrfProtection,
  controller.filter,
);

// US-603: baja lógica, disparada por HTMX desde el ícono de eliminar del
// listado (con confirmación previa vía hx-confirm) — mismo patrón que
// DELETE /doctores/:id (US-608)/DELETE /areas/:id (US-611).
router.delete(
  '/usuarios/:id',
  requireAuth,
  requirePermission('usuarios.eliminar'),
  doubleCsrfProtection,
  controller.darDeBaja,
);

// US-602: alta y edición, mismo formulario en un modal. Los GET solo arman
// el fragmento del formulario (vacío o precargado); los POST/PUT hacen el
// alta/edición real. Cada ruta exige el permiso específico de la acción
// (crear ≠ editar) — así un usuario con uno solo de los dos nunca puede
// ejecutar el otro, aunque el formulario sea visualmente el mismo. US-604
// agrega el apartado de Permisos al mismo formulario (con su propio gate,
// ver requirePermisosSiSePresenta arriba); US-603 (baja) y US-605 (reseteo
// de contraseña) agregarán aquí sus propias rutas de escritura.
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
// US-604 (quinta iteración): sugerencia de username en vivo mientras se
// escribe Nombre(s)/Apellidos en el alta — body, no query string, mismo
// criterio de privacidad que el resto de las rutas HTMX de este módulo (un
// nombre real nunca debe aparecer en la URL/historial). Requiere
// usuarios.crear (el único formulario que la usa) y CSRF, igual que
// cualquier otro POST de este router.
router.post(
  '/usuarios/username-sugerido',
  requireAuth,
  requirePermission('usuarios.crear'),
  doubleCsrfProtection,
  controller.sugerirUsername,
);
router.post(
  '/usuarios',
  requireAuth,
  requirePermission('usuarios.crear'),
  requirePermisosSiSePresenta,
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/usuarios/:id',
  requireAuth,
  requirePermission('usuarios.editar'),
  requirePermisosSiSePresenta,
  doubleCsrfProtection,
  controller.editar,
);

module.exports = router;
