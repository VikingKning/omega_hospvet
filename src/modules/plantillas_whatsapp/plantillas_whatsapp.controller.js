const service = require('./plantillas_whatsapp.service');
const metaSync = require('./plantillas_whatsapp.metaSync');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto, nunca lee
// query params (mismo criterio de privacidad que doctores/areas.controller.js
// — el filtrado real ocurre por el POST de abajo, vía HTMX, sin tocar la URL).
//
// Pedido explícito del usuario: revisar aprobaciones de Meta AL ENTRAR al
// módulo, no solo esperar el job de cada 60 min — revisarAprobaciones()
// nunca lanza (atrapa sus propios errores, ver plantillas_whatsapp.metaSync.js),
// así que un Meta caído nunca rompe la carga de la página, solo la deja
// con la info que ya había. Se espera (await) ANTES de leer el catálogo
// para que, si sí hay algo que actualizar, ya se refleje en este mismo
// render.
async function list(req, res, next) {
  try {
    await metaSync.revisarAprobaciones();
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('plantillas', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// Fragmento HTMX: recibe el filtro/orden/página completos en el body y
// devuelve solo el panel (toolbar + tabla + paginación), no la página
// entera.
async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantillas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-614: baja lógica de una plantilla, disparada por HTMX desde el ícono
// de eliminar del listado (con confirmación previa vía hx-confirm). Igual
// que filter(), recibe el estado de filtro/orden/página actual (el botón
// lo arrastra vía hx-include del mismo <form>) para que el fragmento
// devuelto refleje la vista donde el usuario ya estaba, no un estado por
// defecto.
//
// A diferencia de filter() (POST), aquí SÍ hace falta leer también
// req.query: la config por default de HTMX (`methodsThatUseUrlParams`)
// incluye "delete" junto con "get" — los valores incluidos vía hx-include
// viajan como query string en la URL del DELETE, no como body (mismo
// gotcha ya documentado en doctores.controller.js/areas.controller.js).
async function desactivar(req, res, next) {
  try {
    await service.desactivar(req.params.id, req.session.user.id);
  } catch (err) {
    // Una plantilla predeterminada del sistema: el ícono de eliminar ni
    // siquiera se muestra para estas (ver plantillas-panel.ejs), así que
    // solo llega aquí vía una petición manual — basta un 400 en texto
    // plano, no hace falta un fragmento HTMX especial.
    if (err.status) {
      return res.status(err.status).send(err.message);
    }
    return next(err);
  }

  try {
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantillas-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-613: fragmento HTMX con el formulario vacío ("Nueva plantilla"),
// swapeado dentro del modal.
async function nuevoForm(req, res, next) {
  try {
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantilla-form', {
      plantilla: null,
      intencion: '',
      texto_respuesta: '',
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Ícono "Ver" (gate plantillas.ver, distinto de editar): fragmento HTMX de
// solo lectura con la info completa, incluida veces_usada (que ya no se
// muestra en la tabla).
async function verForm(req, res, next) {
  try {
    const plantilla = await service.obtener(req.params.id);
    if (!plantilla) {
      return res.status(404).send('Plantilla no encontrada');
    }
    res.render('partials/plantilla-detalle', { plantilla });
  } catch (err) {
    next(err);
  }
}

// US-613: fragmento HTMX con el formulario precargado ("Editar plantilla").
async function editarForm(req, res, next) {
  try {
    const plantilla = await service.obtener(req.params.id);
    if (!plantilla) {
      return res.status(404).send('Plantilla no encontrada');
    }
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/plantilla-form', {
      plantilla,
      intencion: plantilla.intencion,
      slug: plantilla.slug,
      texto_respuesta: plantilla.texto_respuesta,
      activo: plantilla.activo,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Tras un alta/edición exitosa: la tabla se refresca vía un swap
// "out-of-band" (el formulario no vive dentro de #plantillas-panel, sino en
// el modal) y el header HX-Trigger le avisa al JS del cliente que cierre
// el modal — ver plantillas.ejs.
async function renderExito(req, res, next, csrfToken) {
  try {
    const data = await service.list({});
    res.set('HX-Trigger', 'closePlantillaModal');
    res.render('partials/plantillas-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-613 AC: alta sin id. Un error de validación o de intención duplicada
// no truena: re-renderiza el mismo formulario con el mensaje, sin cerrar
// el modal.
async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      intencion: req.body.intencion,
      texto_respuesta: req.body.texto_respuesta,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      return res.render('partials/plantilla-form', {
        plantilla: null,
        intencion: req.body.intencion ?? '',
        texto_respuesta: req.body.texto_respuesta ?? '',
        error: err.message,
        csrfToken,
        user: req.session.user,
      });
    }
    return next(err);
  }
  return renderExito(req, res, next, csrfToken);
}

// US-613 AC: edición con id — actualiza SOLO texto_respuesta/activo,
// conserva veces_usada. intención/slug nunca se leen del body (son
// inmutables tras el alta, ver plantillas_whatsapp.service.js#editar) —
// aunque el cliente mande otro valor, se ignora por completo, ni siquiera
// llega al service. Mismo manejo de error que crear(), pero conservando la
// plantilla original (intención/slug de `existing`, nunca de req.body) en
// el formulario re-renderizado (sigue en modo "Editar plantilla").
async function editar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing) {
      return res.status(404).send('Plantilla no encontrada');
    }

    try {
      await service.editar({
        id: req.params.id,
        texto_respuesta: req.body.texto_respuesta,
        activo: req.body.activo,
        esPredeterminada: existing.es_predeterminada,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        return res.render('partials/plantilla-form', {
          plantilla: existing,
          intencion: existing.intencion,
          slug: existing.slug,
          texto_respuesta: req.body.texto_respuesta ?? '',
          activo: req.body.activo === 'true',
          error: err.message,
          csrfToken,
          user: req.session.user,
        });
      }
      throw err;
    }

    return renderExito(req, res, next, csrfToken);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, filter, desactivar, nuevoForm, verForm, editarForm, crear, editar };
