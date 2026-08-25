const hxRedirect = require('./hxRedirect');

// Los permisos se verifican en el middleware de la ruta, nunca dentro del
// controller ni del service (documento de Arquitectura y Buenas Prácticas,
// sección 4.2) — así la regla de acceso vive en un solo lugar, auditable de
// un vistazo en el archivo de rutas. Se consulta el set ya cacheado en
// sesión al hacer login (Decisión 5 de la bitácora), sin volver a golpear la
// base de datos en cada click.
//
// `code` acepta también un array — semántica OR (basta con tener AL MENOS
// uno de la lista). Caso real: /agenda.html muestra en una sola página las
// áreas Consultas y Cirugías combinadas (reconstrucción del menú de
// navegación, ver sidebar.ejs), así que el acceso a esa página exige
// agenda_consultas.ver O agenda_cirugias.ver, no ambos — un usuario con
// visibilidad de solo una de las dos áreas igual debe poder entrar.
//
// `code` también acepta una función `(req) => code|code[]`, evaluada en
// CADA request en vez de una sola vez al registrar la ruta — necesario para
// rutas con el área en la URL (`/agenda/:slug.html`), donde el código de
// permiso (`agenda.<slug>.ver`) depende de `req.params.slug`, que no existe
// todavía cuando se arma el router. Misma extensión mínima/retrocompatible
// que el soporte de array: ningún caller existente (que pasa un string o
// array suelto) cambia de comportamiento.
function requirePermission(code) {
  return (req, res, next) => {
    const resolved = typeof code === 'function' ? code(req) : code;
    const codes = Array.isArray(resolved) ? resolved : [resolved];
    const permissions = req.session.user?.permissions ?? [];

    if (!codes.some((c) => permissions.includes(c))) {
      // Sin página de acceso denegado todavía: se regresa al shell del panel
      // en vez de mostrar el módulo al que no tiene acceso.
      return hxRedirect(req, res, '/main.html');
    }

    next();
  };
}

module.exports = requirePermission;
