const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const writeLimiter = require('../../middlewares/writeLimiter');
const attachSidebarAreas = require('../../middlewares/attachSidebarAreas');
const { doubleCsrfProtection } = require('../../config/csrf');
const controller = require('./tutores.controller');

const router = express.Router();

router.get(
  '/tutores.html',
  requireAuth,
  requirePermission('tutores.ver'),
  attachSidebarAreas,
  controller.list,
);

// Filtro/paginación vía HTMX: nunca aparece en la URL ni en el historial del
// navegador (privacidad de lo que se busca, mismo criterio que
// doctores.routes.js/areas.routes.js). El body viaja igual de "sucio" que
// un query string, así que se protege con el mismo CSRF que POST /login —
// no es un GET disfrazado.
router.post(
  '/tutores.html',
  requireAuth,
  requirePermission('tutores.ver'),
  writeLimiter,
  doubleCsrfProtection,
  controller.filter,
);

// US-156: alta y edición combinada — a diferencia de doctores/áreas
// (formulario en un modal, fragmento HTMX), este formulario es una página
// completa propia (mockup de esta historia), así que GET /tutores/nuevo y
// GET /tutores/:id/editar renderizan la página entera con su sidebar
// (attachSidebarAreas, mismo criterio que cualquier otra ruta de página
// completa) en vez de un fragmento. Cada ruta exige el permiso específico
// de la acción (crear ≠ editar) — así un usuario con uno solo de los dos
// nunca puede ejecutar el otro, aunque el formulario sea el mismo (AC21/22).
router.get(
  '/tutores/nuevo',
  requireAuth,
  requirePermission('tutores.crear'),
  attachSidebarAreas,
  controller.nuevoForm,
);
router.get(
  '/tutores/:id/editar',
  requireAuth,
  requirePermission('tutores.editar'),
  attachSidebarAreas,
  controller.editarForm,
);

// US-156 (pedido del usuario): búsqueda en vivo del teléfono mientras se
// captura el alta — para poder pasar a editar un propietario existente en
// vez de arriesgar un duplicado. Se ofrece a cualquiera que llegue a
// /tutores/nuevo (mismo permiso que esa página, tutores.crear) — si el
// usuario selecciona un resultado, GET /tutores/:id/editar exige
// tutores.editar por su cuenta, no hace falta duplicar ese chequeo aquí.
// Va por POST con el término en el body, nunca la URL — mismo criterio de
// privacidad que el resto de las búsquedas del sistema.
router.post(
  '/tutores/buscar-telefono',
  requireAuth,
  requirePermission('tutores.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarTelefono,
);

// Agenda: combobox de "Mascota" del formulario de citas (ver agenda.ejs) —
// vive en este módulo porque `mascotas` es su tabla (mismo criterio que
// buscar-telefono), pero el permiso NO es `tutores.*`: quien agenda citas
// no necesariamente tiene acceso al módulo de Tutores, así que se exige el
// permiso de agenda del área que manda en el body (`agenda.<slug>.crear`),
// evaluado por request — mismo mecanismo que las rutas de agenda.routes.js.
router.post(
  '/tutores/buscar-mascota',
  requireAuth,
  requirePermission((req) => `agenda.${req.body.slug}.crear`),
  writeLimiter,
  doubleCsrfProtection,
  controller.buscarMascota,
);

// US-157 (ajuste posterior, pedido del usuario): chequeo exacto del
// teléfono al salir del campo (blur) en el alta — a diferencia de la
// búsqueda de arriba (parcial, solo activos), este SÍ revela un
// propietario inactivo con su información completa, porque es justo el
// punto de entrada para reactivarlo. Mismo permiso/CSRF que buscar-telefono.
router.post(
  '/tutores/verificar-telefono',
  requireAuth,
  requirePermission('tutores.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.verificarTelefono,
);

// POST/PUT reciben y devuelven JSON (fetch() desde tutor-form.ejs, no HTMX)
// — mismo patrón que auth.routes.js#login, no el de doctores/areas.routes.js.
router.post(
  '/tutores',
  requireAuth,
  requirePermission('tutores.crear'),
  writeLimiter,
  doubleCsrfProtection,
  controller.crear,
);
router.put(
  '/tutores/:id',
  requireAuth,
  requirePermission('tutores.editar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.editar,
);

// US-157: baja lógica de un tutor, disparada por HTMX desde el ícono de
// eliminar del listado (con confirmación previa vía hx-confirm). Mismo
// patrón que doctores.routes.js/areas.routes.js.
router.delete(
  '/tutores/:id',
  requireAuth,
  requirePermission('tutores.eliminar'),
  writeLimiter,
  doubleCsrfProtection,
  controller.desactivar,
);

module.exports = router;
