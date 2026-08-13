const service = require('./doctores.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto, nunca lee
// query params (así una URL pegada a mano nunca filtra nada — el filtrado
// real solo ocurre por el POST de abajo, vía HTMX, sin tocar la URL).
async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('doctores', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// Fragmento HTMX: recibe el filtro/orden/página completos en el body y
// devuelve solo el panel (toolbar + tabla + paginación), no la página
// entera. Reemite el token CSRF porque el fragmento vuelve a traer el
// <form> con su propio hx-headers.
async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-608: baja lógica de un doctor. Igual que filter(), recibe el estado de
// filtro/orden/página actual (el botón lo arrastra vía hx-include del mismo
// <form>) para que el fragmento devuelto refleje la vista donde el usuario
// ya estaba, no un estado por defecto.
//
// A diferencia de filter() (POST), aquí SÍ hace falta leer también
// req.query: la config por default de HTMX (`methodsThatUseUrlParams`)
// incluye "delete" junto con "get" — los valores incluidos vía hx-include
// viajan como query string en la URL del DELETE, no como body. Si solo se
// lee req.body (vacío en ese caso), el fragmento devuelto pierde el filtro
// activo del usuario silenciosamente (sin error, por eso no se notaba en
// curl — ahí el body se mandaba a mano).
async function desactivar(req, res, next) {
  try {
    await service.desactivar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-607: fragmento HTMX con el formulario vacío ("Nuevo doctor"), con el
// checkbox de Activo marcado por defecto y sin especialidades.
async function nuevoForm(req, res, next) {
  try {
    const areasDisponibles = await service.listAreasDisponibles();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctor-form', {
      doctor: null,
      nombre: '',
      apellidos: '',
      activo: true,
      areasDisponibles,
      areasSeleccionadas: [],
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// US-607: fragmento HTMX con el formulario precargado ("Editar doctor"),
// incluida su selección actual de especialidades.
async function editarForm(req, res, next) {
  try {
    const doctor = await service.obtener(req.params.id);
    if (!doctor) {
      return res.status(404).send('Doctor no encontrado');
    }
    const areasDisponibles = await service.listAreasDisponibles();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/doctor-form', {
      doctor,
      nombre: doctor.nombre,
      apellidos: doctor.apellidos,
      activo: doctor.activo,
      areasDisponibles,
      areasSeleccionadas: doctor.areas,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Tras un alta/edición exitosa: la tabla se refresca vía un swap
// "out-of-band" (el formulario no vive dentro de #doctores-panel, sino en
// el modal) y el header HX-Trigger le avisa al JS del cliente que cierre
// el modal — ver doctores.ejs.
async function renderExito(req, res, next, csrfToken) {
  try {
    const data = await service.list({});
    res.set('HX-Trigger', 'closeDoctorModal');
    res.render('partials/doctores-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-607 AC: alta sin id. Un error de validación no truena: re-renderiza
// el mismo formulario con el mensaje, conservando lo que el usuario había
// escrito y las especialidades que ya había armado en la tabla (no lo que
// ya está en la base, que para un alta ni siquiera existe todavía).
async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      activo: req.body.activo,
      areaIds: req.body.areaIds,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      const [areasDisponibles, areasSeleccionadas] = await Promise.all([
        service.listAreasDisponibles(),
        service.resolverAreas(req.body.areaIds),
      ]);
      return res.render('partials/doctor-form', {
        doctor: null,
        nombre: req.body.nombre ?? '',
        apellidos: req.body.apellidos ?? '',
        activo: req.body.activo === 'true',
        areasDisponibles,
        areasSeleccionadas,
        error: err.message,
        csrfToken,
        user: req.session.user,
      });
    }
    return next(err);
  }
  return renderExito(req, res, next, csrfToken);
}

// US-607 AC: edición con id — actualiza doctores y sustituye la selección
// de especialidades. Mismo manejo de error que crear(), pero conservando
// el doctor original en el formulario re-renderizado (sigue en modo
// "Editar doctor").
async function editar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing) {
      return res.status(404).send('Doctor no encontrado');
    }

    try {
      await service.editar({
        id: req.params.id,
        nombre: req.body.nombre,
        apellidos: req.body.apellidos,
        activo: req.body.activo,
        areaIds: req.body.areaIds,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        const [areasDisponibles, areasSeleccionadas] = await Promise.all([
          service.listAreasDisponibles(),
          service.resolverAreas(req.body.areaIds),
        ]);
        return res.render('partials/doctor-form', {
          doctor: existing,
          nombre: req.body.nombre ?? '',
          apellidos: req.body.apellidos ?? '',
          activo: req.body.activo === 'true',
          areasDisponibles,
          areasSeleccionadas,
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

module.exports = { list, filter, desactivar, nuevoForm, editarForm, crear, editar };
