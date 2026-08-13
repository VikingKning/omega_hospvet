// Un res.redirect() normal, si la petición viene de HTMX (hx-post/hx-get),
// se sigue automáticamente y el HTML de destino (ej. el login) termina
// insertado dentro del contenedor que se esperaba actualizar — UI rota.
// HTMX documenta HX-Redirect justo para esto: fuerza una navegación real de
// página completa en el cliente en vez de un swap. Las páginas que no usan
// HTMX nunca mandan el header HX-Request, así que su comportamiento no
// cambia (siguen con el res.redirect() de siempre).
function hxRedirect(req, res, url) {
  if (req.get('HX-Request') === 'true') {
    res.set('HX-Redirect', url);
    return res.sendStatus(200);
  }
  return res.redirect(url);
}

module.exports = hxRedirect;
