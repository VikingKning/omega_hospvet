const service = require('./usuarios.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto, nunca lee
// query params (mismo criterio de privacidad que el resto de los
// catálogos de Configuraciones — el filtrado real ocurre por el POST de
// abajo, vía HTMX, sin tocar la URL).
async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('usuarios', { ...data, user: req.session.user, csrfToken });
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
    res.render('partials/usuarios-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-603: baja lógica, disparada por HTMX desde el ícono de baja del
// listado (con confirmación previa vía hx-confirm). Igual que
// doctores.controller.js#desactivar, hace falta leer también req.query: la
// config por default de HTMX (`methodsThatUseUrlParams`) incluye "delete"
// junto con "get" — los valores de hx-include viajan como query string en
// la URL del DELETE, no como body; si solo se leyera req.body el fragmento
// devuelto perdería el filtro/orden/página donde el usuario ya estaba.
//
// A diferencia de doctores/áreas, aquí el service SÍ puede rechazar la
// operación (AC: "propia cuenta") — se captura el error de negocio (con
// `.status`) y se re-renderiza el mismo panel con el mensaje, en vez de
// dejar que llegue crudo al error handler genérico. Un error inesperado
// (sin `.status`) sigue su curso normal hacia next(err).
async function darDeBaja(req, res, next) {
  try {
    let error = null;
    try {
      await service.darDeBaja(req.params.id, req.session.user.id);
    } catch (err) {
      if (!err.status) throw err;
      error = err.message;
    }
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuarios-panel', { ...data, user: req.session.user, csrfToken, error });
  } catch (err) {
    next(err);
  }
}

// US-602: fragmento HTMX con el formulario vacío ("Nuevo usuario"),
// swapeado dentro del modal. US-604: el catálogo de permisos viaja siempre
// (agrupado por módulo) — el partial decide si lo muestra según
// usuarios.permisos de la sesión, mismo criterio que el resto de los
// botones/columnas gateados por permiso en las vistas de este módulo.
async function nuevoForm(req, res, next) {
  try {
    const [doctoresDisponibles, catalogoPermisos, areasParaPermisos] = await Promise.all([
      service.listDoctoresDisponibles(),
      service.obtenerCatalogoPermisos(),
      service.listAreasParaPermisos(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuario-form', {
      usuario: null,
      nombre: '',
      apellidos: '',
      correo: '',
      telefono: '',
      username: '',
      estatus: 'activo',
      doctorSeleccionado: null,
      doctoresDisponibles,
      matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
      permisosAsignadosIds: [],
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// US-602: fragmento HTMX con el formulario precargado ("Editar usuario"),
// sin el campo de contraseña (AC: no aparece ni puede modificarse desde
// esta funcionalidad). US-604: además precarga los permisos ya asignados.
// US-602 (octava iteración) AC: el vínculo con un doctor tampoco se puede
// modificar desde aquí — `usuario-form.ejs` lo muestra de solo lectura en
// edición, así que ni hace falta pedir el catálogo de doctores disponibles
// (se manda `[]`, la isla de datos JSON de usuarios.ejs igual la necesita
// como array válido, aunque no se use).
async function editarForm(req, res, next) {
  try {
    const usuario = await service.obtener(req.params.id);
    if (!usuario) {
      return res.status(404).send('Usuario no encontrado');
    }
    const [catalogoPermisos, permisosAsignadosIds, areasParaPermisos] = await Promise.all([
      service.obtenerCatalogoPermisos(),
      service.permisosAsignadosDe(usuario.id),
      service.listAreasParaPermisos(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/usuario-form', {
      usuario,
      nombre: usuario.nombre,
      apellidos: usuario.apellidos,
      correo: usuario.correo,
      telefono: usuario.telefono ?? '',
      username: usuario.username,
      estatus: usuario.estatus,
      doctorSeleccionado: usuario.doctor ?? null,
      doctoresDisponibles: [],
      matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
      permisosAsignadosIds,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// US-604 (quinta iteración): fragmento JSON (no HTML) — el JS del cliente
// lo consulta mientras el administrador escribe Nombre(s)/Apellidos, para
// proponer un username en vivo (usuarios.ejs). Requiere usuarios.crear:
// es la misma condición para siquiera poder abrir el formulario de alta,
// que es el único que usa esta ruta (en edición no se autopropone, para no
// arriesgarse a cambiar el username de una cuenta ya en uso solo porque se
// corrigió un acento en el apellido).
async function sugerirUsername(req, res, next) {
  try {
    const username = await service.sugerirUsername(req.body.nombre, req.body.apellidos);
    res.json({ username });
  } catch (err) {
    next(err);
  }
}

// Tras un alta/edición exitosa: la tabla se refresca vía un swap
// "out-of-band" (el formulario no vive dentro de #usuarios-panel, sino en
// el modal) y el header HX-Trigger le avisa al JS del cliente que cierre
// el modal — ver usuarios.ejs.
async function renderExito(req, res, next, csrfToken) {
  try {
    const data = await service.list({});
    res.set('HX-Trigger', 'closeUsuarioModal');
    res.render('partials/usuarios-panel-oob', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-602 AC: alta sin id. Un error de validación o de username/correo
// duplicado no truena: re-renderiza el mismo formulario con el mensaje,
// sin cerrar el modal. US-604: los permisos que el usuario ya había
// marcado se conservan en el reintento (parseados de vuelta, no se pierde
// la selección solo porque falló el nombre o el correo).
async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      correo: req.body.correo,
      telefono: req.body.telefono,
      username: req.body.username,
      password: req.body.password,
      doctorId: req.body.doctorId,
      permisos: req.body.permisos,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      const [doctoresDisponibles, doctorSeleccionado, catalogoPermisos, areasParaPermisos] =
        await Promise.all([
          service.listDoctoresDisponibles(),
          service.resolverDoctor(req.body.doctorId),
          service.obtenerCatalogoPermisos(),
          service.listAreasParaPermisos(),
        ]);
      return res.render('partials/usuario-form', {
        usuario: null,
        nombre: req.body.nombre ?? '',
        apellidos: req.body.apellidos ?? '',
        correo: req.body.correo ?? '',
        telefono: req.body.telefono ?? '',
        username: err.usernameSugerido ?? req.body.username ?? '',
        estatus: 'activo',
        doctorSeleccionado: doctorSeleccionado ?? null,
        doctoresDisponibles,
        matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
        permisosAsignadosIds: service.parsePermissionIds(req.body.permisos),
        error: err.message,
        csrfToken,
        user: req.session.user,
      });
    }
    return next(err);
  }
  return renderExito(req, res, next, csrfToken);
}

// US-602 AC: edición con id — actualiza datos generales + estatus, nunca
// la contraseña. Mismo manejo de error que crear(), pero conservando el
// usuario original en el formulario re-renderizado (sigue en modo "Editar
// usuario"). US-604: `permisosSeccion` es el marcador oculto que solo viaja
// cuando el apartado de Permisos SÍ se mostró (usuario_form.ejs) — su
// presencia es lo único que distingue "no tiene usuarios.permisos" de "los
// desmarcó todos", ambos casos indistinguibles si solo se mirara si
// `permisos` viene o no (un checkbox group sin nada marcado tampoco manda
// esa clave).
async function editar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing) {
      return res.status(404).send('Usuario no encontrado');
    }

    const permisosProvistos = req.body.permisosSeccion !== undefined;

    try {
      // US-602 (octava iteración) AC: el vínculo con un doctor no se puede
      // tocar desde edición — a propósito NO se manda `doctorId` a
      // service.editar() (ese parámetro ya ni existe en su firma), aunque
      // el body trajera uno (el formulario ni siquiera lo envía en modo
      // edición, ver usuario-form.ejs).
      await service.editar({
        id: req.params.id,
        nombre: req.body.nombre,
        apellidos: req.body.apellidos,
        correo: req.body.correo,
        telefono: req.body.telefono,
        username: req.body.username,
        estatus: req.body.estatus,
        permisos: req.body.permisos,
        permisosProvistos,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        const [catalogoPermisos, permisosActuales, areasParaPermisos] = await Promise.all([
          service.obtenerCatalogoPermisos(),
          service.permisosAsignadosDe(existing.id),
          service.listAreasParaPermisos(),
        ]);
        return res.render('partials/usuario-form', {
          usuario: existing,
          nombre: req.body.nombre ?? '',
          apellidos: req.body.apellidos ?? '',
          correo: req.body.correo ?? '',
          telefono: req.body.telefono ?? '',
          username: err.usernameSugerido ?? req.body.username ?? '',
          estatus: req.body.estatus ?? existing.estatus,
          doctorSeleccionado: existing.doctor ?? null,
          doctoresDisponibles: [],
          matrizPermisos: service.construirMatrizPermisos(catalogoPermisos, areasParaPermisos),
          permisosAsignadosIds: permisosProvistos
            ? service.parsePermissionIds(req.body.permisos)
            : permisosActuales,
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

module.exports = {
  list,
  filter,
  darDeBaja,
  nuevoForm,
  editarForm,
  sugerirUsername,
  crear,
  editar,
};
