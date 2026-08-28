const service = require('./laboratorio.service');
const { generateCsrfToken } = require('../../config/csrf');
const fs = require('fs');

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
      modoCargarArchivos: false,
      catalogo,
      doctores,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Misma pantalla para /editar, /ver y /cargar — pedido explícito del
// usuario: "usar el mismo de agregar/editar para ver la información, solo
// ocultar los botones y el formulario de seleccionar estudio", que es
// exactamente lo que ya hace `soloLectura` (oculta el picker server-side,
// el botón Guardar, y deshabilita todos los campos). `forzarSoloLectura`
// distingue las rutas: /editar respeta el permiso real del usuario (si no
// tiene laboratorio.editar, cae en solo lectura de todos modos, como ya
// hacía); /ver y /cargar SIEMPRE son de solo lectura sin importar el
// permiso de editar. `modoCargarArchivos` es la diferencia entre esas dos
// últimas — corrección explícita del usuario: "Ver" es PURAMENTE
// informativa (qué se mandó, a quién, cuándo), nunca debe ofrecer subir
// nada; el ícono de "Subir resultados" de la tabla abre /cargar, la única
// ruta que muestra los controles de carga (ver laboratorio-form.ejs,
// puedeCargarArchivos ya no depende de soloLectura genérico).
async function formularioDeRegistro(req, res, next, { forzarSoloLectura, modoCargarArchivos }) {
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
      modoCargarArchivos: Boolean(modoCargarArchivos),
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
  return formularioDeRegistro(req, res, next, {
    forzarSoloLectura: false,
    modoCargarArchivos: false,
  });
}

async function verForm(req, res, next) {
  return formularioDeRegistro(req, res, next, {
    forzarSoloLectura: true,
    modoCargarArchivos: false,
  });
}

// Ícono "Subir resultados" de la tabla — pedido explícito del usuario, en
// vez de la pantalla de Ver (que se queda puramente informativa).
async function cargarForm(req, res, next) {
  return formularioDeRegistro(req, res, next, {
    forzarSoloLectura: true,
    modoCargarArchivos: true,
  });
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

// Carga de archivos de resultados (pedido explícito del usuario) — un
// archivo (o varios, que el service fusiona en un PDF) para TODOS los
// estudios de la orden.
async function subirArchivoRegistro(req, res, next) {
  try {
    const resultado = await service.subirArchivoParaTodos(
      req.params.id,
      req.files,
      req.session.user.id,
    );
    res.json({ ok: true, reutilizado: resultado.reutilizado });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

// Mismo mecanismo, para UN estudio en particular.
async function subirArchivoEstudio(req, res, next) {
  try {
    const resultado = await service.subirArchivoParaEstudio(
      req.params.id,
      req.params.estudioId,
      req.files,
      req.session.user.id,
    );
    res.json({ ok: true, reutilizado: resultado.reutilizado });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

// Quitar un archivo ya cargado (pedido explícito del usuario: "por si se
// equivocó el usuario") — no necesita multer, no lleva body. `usuarioId`
// sí hace falta ahora (bug real corregido en US-409 v2: antes no viajaba
// en absoluto) — retirado_por/retirado_en lo necesitan para auditoría.
async function eliminarArchivoRegistro(req, res, next) {
  try {
    await service.eliminarArchivoDeTodos(req.params.id, req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

async function eliminarArchivoEstudio(req, res, next) {
  try {
    await service.eliminarArchivoDeEstudio(
      req.params.id,
      req.params.estudioId,
      req.session.user.id,
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

// Descarga autenticada — nunca por static serving directo (ver comentario
// del .gitignore, son resultados médicos de pacientes).
async function descargarArchivo(req, res, next) {
  try {
    const archivo = await service.obtenerArchivoParaDescarga(req.params.archivoId);
    if (!archivo || !fs.existsSync(archivo.rutaAbsoluta)) {
      return res.status(404).send('Archivo no encontrado');
    }
    res.download(archivo.rutaAbsoluta, archivo.nombreOriginal);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  pagina,
  filter,
  eliminar,
  nuevoForm,
  editarForm,
  verForm,
  cargarForm,
  buscarTutor,
  buscarTutorPorNombre,
  crear,
  editar,
  subirArchivoRegistro,
  subirArchivoEstudio,
  eliminarArchivoRegistro,
  eliminarArchivoEstudio,
  descargarArchivo,
};
