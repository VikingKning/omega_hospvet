const service = require('./laboratorio.service');
const { generateCsrfToken } = require('../../config/csrf');

// Carga inicial de la página: siempre el estado por defecto, nunca lee query
// params (mismo criterio que doctores.controller.js#list — así una URL
// pegada a mano nunca filtra nada, el filtrado real solo ocurre por el POST
// de abajo, vía HTMX, sin tocar la URL).
async function pagina(req, res, next) {
  try {
    const data = await service.list({});
    const categorias = await service.listCategorias();
    const csrfToken = generateCsrfToken(req, res);
    res.render('laboratorio', { ...data, categorias, user: req.session.user, csrfToken });
  } catch (err) {
    next(err);
  }
}

// Fragmento HTMX: filtro/orden/página completos en el body, devuelve solo
// el panel (toolbar + tabla + paginación) — mismo patrón que
// doctores.controller.js#filter.
async function filter(req, res, next) {
  try {
    const data = await service.list(req.body);
    const categorias = await service.listCategorias();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/laboratorio-panel', {
      ...data,
      categorias,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

// Baja lógica de una orden. Igual que doctores.controller.js#desactivar:
// hx-include viaja como query string en un DELETE (methodsThatUseUrlParams
// de HTMX), por eso se leen req.query Y req.body para no perder el filtro
// activo del usuario en el panel que se devuelve.
async function eliminar(req, res, next) {
  try {
    await service.eliminar(req.params.id, req.session.user.id);
    const data = await service.list({ ...req.query, ...req.body });
    const categorias = await service.listCategorias();
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/laboratorio-panel', {
      ...data,
      categorias,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

// Pedido explícito del usuario: alta/edición/consulta son cada una su
// propia pantalla completa (mismo patrón que tutor-form.ejs), no un modal
// sobre la tabla — a diferencia del resto de los módulos del sistema
// (doctor-form.ejs/area-form.ejs/plantilla-form.ejs, todos modales).
async function nuevoForm(req, res, next) {
  try {
    const [catalogo, doctores] = await Promise.all([
      service.catalogoParaFormulario(),
      service.listarDoctoresActivos(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('laboratorio-form', {
      registro: null,
      // Pedido explícito del usuario: si quien registra la orden es, él
      // mismo, un doctor vinculado (usuarios.doctor_id, cacheado en
      // sesión al hacer login — ver auth.service.js#login), se
      // preselecciona como "Dr. solicitante"; si no, se deja en blanco.
      doctorIdPreseleccionado: req.session.user.doctorId ?? null,
      soloLectura: false,
      catalogo,
      doctores,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Misma pantalla para /editar y /ver — pedido explícito del usuario:
// "usar el mismo de agregar/editar para ver la información, solo ocultar
// los botones y el formulario de seleccionar estudio", que es exactamente
// lo que ya hace `soloLectura` (oculta el picker server-side, el botón
// Guardar, y deshabilita todos los campos). `forzarSoloLectura` distingue
// las dos rutas: /editar respeta el permiso real del usuario (si no tiene
// laboratorio.editar, cae en solo lectura de todos modos, como ya hacía);
// /ver SIEMPRE es de solo lectura sin importar el permiso — es el ícono de
// "ojo" nuevo en la tabla, para que alguien con permiso de editar pueda
// abrir un registro solo para consultarlo sin riesgo de modificarlo.
async function formularioDeRegistro(req, res, next, forzarSoloLectura) {
  try {
    const registro = await service.obtenerParaEditar(req.params.id);
    if (!registro) {
      return res.status(404).send('Registro no encontrado');
    }
    const [catalogo, doctores] = await Promise.all([
      service.catalogoParaFormulario(),
      service.listarDoctoresActivos(),
    ]);
    const permissions = req.session.user.permissions ?? [];
    const csrfToken = generateCsrfToken(req, res);
    res.render('laboratorio-form', {
      registro,
      doctorIdPreseleccionado: null,
      soloLectura: forzarSoloLectura || !permissions.includes('laboratorio.editar'),
      catalogo,
      doctores,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function editarForm(req, res, next) {
  return formularioDeRegistro(req, res, next, false);
}

async function verForm(req, res, next) {
  return formularioDeRegistro(req, res, next, true);
}

// Búsqueda de tutor por teléfono para el formulario de "Nuevo registro"
// (pedido explícito del usuario: "si escribo un teléfono, la información se
// tiene que mostrar") — vive en este módulo (no en tutores.routes.js)
// porque el permiso correcto aquí es `laboratorio.crear`, mismo motivo que
// el comentario de /tutores/buscar-mascota en tutores.routes.js.
async function buscarTutor(req, res, next) {
  try {
    const tutor = await service.resolverTutorPorTelefono(req.body.telefono);
    res.json(tutor ? { existe: true, tutor } : { existe: false });
  } catch (err) {
    next(err);
  }
}

// Combobox "buscar tutor por nombre" — pedido explícito del usuario, para
// cuando no se conoce el teléfono. Mismo permiso que buscarTutor (solo se
// usa en "Nuevo registro").
async function buscarTutorPorNombre(req, res, next) {
  try {
    const tutores = await service.buscarTutoresPorNombre(req.body.q);
    res.json({ tutores });
  } catch (err) {
    next(err);
  }
}

// Alta — respuesta JSON con redirectTo (mismo patrón que
// tutores.controller.js#crear: esta pantalla también es una página propia
// que habla con el servidor vía fetch(), no un fragmento HTMX).
async function crear(req, res, next) {
  try {
    const id = await service.crear({ ...req.body, usuarioId: req.session.user.id });
    res.status(201).json({ id, redirectTo: 'laboratorio.html' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function editar(req, res, next) {
  try {
    await service.editar(req.params.id, { ...req.body, usuarioId: req.session.user.id });
    res.json({ redirectTo: 'laboratorio.html' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = {
  pagina,
  filter,
  eliminar,
  nuevoForm,
  editarForm,
  verForm,
  buscarTutor,
  buscarTutorPorNombre,
  crear,
  editar,
};
