const hxRedirect = require('./hxRedirect');

// Los permisos se verifican en el middleware de la ruta, nunca dentro del
// controller ni del service (documento de Arquitectura y Buenas Prácticas,
// sección 4.2) — así la regla de acceso vive en un solo lugar, auditable de
// un vistazo en el archivo de rutas. Se consulta el set ya cacheado en
// sesión al hacer login (Decisión 5 de la bitácora), sin volver a golpear la
// base de datos en cada click.
function requirePermission(code) {
  return (req, res, next) => {
    const permissions = req.session.user?.permissions ?? [];

    if (!permissions.includes(code)) {
      // Sin página de acceso denegado todavía: se regresa al shell del panel
      // en vez de mostrar el módulo al que no tiene acceso.
      return hxRedirect(req, res, '/main.html');
    }

    next();
  };
}

module.exports = requirePermission;
