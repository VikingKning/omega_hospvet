const service = require('./tutores.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto (Tutores y
// Pacientes en "Activos"), nunca lee query params — mismo criterio que
// doctores/areas.controller.js: una URL pegada a mano nunca filtra nada,
// el filtrado real solo ocurre por el POST de abajo, vía HTMX.
async function list(req, res, next) {
  try {
    const data = await service.list({});
    const csrfToken = generateCsrfToken(req, res);
    res.render('tutores', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// Fragmento HTMX: recibe el filtro/página completos en el body y devuelve
// solo el panel (toolbar + tabla + paginación), no la página entera.
async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/tutores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// US-156 AC1: página completa de alta — sin id, título "Nuevo propietario"
// (decidido junto al usuario: a diferencia de doctores/áreas, este
// formulario es una página real con su propio route, no un fragmento HTMX
// dentro de un modal — el mockup de esta historia lo pide así).
function nuevoForm(req, res) {
  const csrfToken = generateCsrfToken(req, res);
  res.render('tutor-form', {
    propietario: null,
    pacientes: [],
    user: req.session.user,
    csrfToken,
  });
}

// US-156 AC2: página completa de edición — con id, precarga tutor+pacientes,
// título "Editar propietario".
async function editarForm(req, res, next) {
  try {
    const propietario = await service.obtenerParaEditar(req.params.id);
    if (!propietario) {
      return res.status(404).send('Propietario no encontrado');
    }
    const csrfToken = generateCsrfToken(req, res);
    res.render('tutor-form', {
      propietario,
      pacientes: propietario.pacientes,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

// US-156 AC7-AC13: alta. Respuesta JSON (no un fragmento HTML) — a
// diferencia de doctores/áreas, este formulario vive en una página propia
// que habla con el servidor vía fetch(), mismo patrón que
// auth.controller.js#login/cambiarPassword.
async function crear(req, res, next) {
  try {
    const id = await service.crear({
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      telefono: req.body.telefono,
      correo: req.body.correo,
      pacientes: req.body.pacientes,
      confirmarReactivacion: req.body.confirmarReactivacion === true,
      usuarioId: req.session.user.id,
    });
    // "Guardar y continuar" (decidido con el usuario) necesita el estado ya
    // guardado — con los ids reales de las mascotas recién insertadas — para
    // seguir editando en la misma página sin recargar; se manda siempre,
    // "Guardar" simplemente lo ignora y navega a redirectTo.
    const propietario = await service.obtenerParaEditar(id);
    res.json({ id, redirectTo: '/tutores.html', propietario });
  } catch (err) {
    if (err instanceof service.RequiereConfirmacionReactivacionError) {
      return res.json({ requiereConfirmacion: true, tutorExistente: err.tutorExistente });
    }
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// US-156 AC15-AC21: edición.
async function editar(req, res, next) {
  try {
    const id = await service.editar({
      id: req.params.id,
      nombre: req.body.nombre,
      apellidos: req.body.apellidos,
      telefono: req.body.telefono,
      correo: req.body.correo,
      activo: req.body.activo,
      pacientes: req.body.pacientes,
      usuarioId: req.session.user.id,
    });
    const propietario = await service.obtenerParaEditar(id);
    res.json({ id, redirectTo: '/tutores.html', propietario });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// US-156 (pedido del usuario): búsqueda en vivo del teléfono en el alta —
// devuelve coincidencias para que el cliente ofrezca "editar en vez de dar
// de alta". Va por POST con el término en el body (no query string), mismo
// criterio de privacidad que el resto de las búsquedas del sistema.
async function buscarTelefono(req, res, next) {
  try {
    const resultados = await service.buscarPorTelefono(req.body.q);
    res.json(resultados);
  } catch (err) {
    next(err);
  }
}

// US-157 (ajuste posterior): chequeo exacto del teléfono al salir del
// campo (blur) en el alta — ver tutores.service.js#verificarTelefono.
// Agenda: combobox de "Mascota" del formulario de citas — mismo patrón que
// buscarTelefono (POST con el término en el body, responde JSON). Vive en
// este módulo porque `mascotas` es su tabla, aunque quien la use en la
// práctica sea el módulo agenda (ver agenda.routes.js).
async function buscarMascota(req, res, next) {
  try {
    const resultados = await service.buscarMascotas(req.body.q);
    res.json(resultados);
  } catch (err) {
    next(err);
  }
}

async function verificarTelefono(req, res, next) {
  try {
    const resultado = await service.verificarTelefono(req.body.telefono);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

// Agenda: combobox de "Tutor" del formulario de citas (pedido explícito
// del usuario — tutor primero, después mascota) — mismo patrón que
// buscarTutor/buscarTutorPorNombre de laboratorio.controller.js, ambos ya
// delegados en las mismas funciones de tutores.service.js. Vive aquí (no
// en agenda.routes.js) por el mismo motivo que buscarMascota: `mascotas`/
// `propietarios` son tablas de este módulo.
async function buscarTutorTelefono(req, res, next) {
  try {
    const tutor = await service.resolverTutorActivoPorTelefono(req.body.telefono);
    res.json(tutor ? { existe: true, tutor } : { existe: false });
  } catch (err) {
    next(err);
  }
}

async function buscarTutorNombre(req, res, next) {
  try {
    const tutores = await service.buscarActivosPorNombre(req.body.q);
    res.json({ tutores });
  } catch (err) {
    next(err);
  }
}

// US-157: baja lógica de un tutor. Igual que doctores.controller.js#
// desactivar: recibe el estado de filtro/orden/página actual (el ícono lo
// arrastra vía hx-include del mismo <form>) para que el fragmento devuelto
// refleje la vista donde el usuario ya estaba, no un estado por defecto.
//
// A diferencia de filter() (POST), aquí SÍ hace falta leer también
// req.query: la config por default de HTMX (`methodsThatUseUrlParams`)
// incluye "delete" junto con "get" — los valores incluidos vía hx-include
// viajan como query string en la URL del DELETE, no como body.
async function desactivar(req, res, next) {
  try {
    await service.desactivar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/tutores-panel', { ...data, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  filter,
  nuevoForm,
  editarForm,
  crear,
  editar,
  buscarTelefono,
  buscarMascota,
  verificarTelefono,
  buscarTutorTelefono,
  buscarTutorNombre,
  desactivar,
};
