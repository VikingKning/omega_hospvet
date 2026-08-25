const service = require('./agenda.service');
const tutoresService = require('../tutores/tutores.service');
const { generateCsrfToken } = require('../../config/csrf');
const { findColor } = require('../areas/googleCalendarColors');

// Resuelve `:slug` contra un área real/activa UNA vez por request y la deja
// en `req.area` — evita que cada una de las rutas de este módulo repita su
// propio "buscar área, 404 si no existe" (mismo espíritu que
// attachSidebarAreas, pero esta sí puede cortar la respuesta con un 404).
async function attachArea(req, res, next) {
  try {
    const area = await service.resolverArea(req.params.slug);
    if (!area) {
      return res.status(404).send('Área no encontrada');
    }
    req.area = area;
    next();
  } catch (err) {
    next(err);
  }
}

// GET /agenda/:slug.html — página completa: resumen del día + el
// contenedor donde el JS del cliente monta FullCalendar (feed real vía
// GET /agenda/:slug/citas.json).
async function pagina(req, res, next) {
  try {
    const [resumen, doctores] = await Promise.all([
      service.resumenDelDia(req.area.id),
      service.listarDoctoresDelArea(req.area.id),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('agenda', {
      area: req.area,
      color: findColor(req.area.color_google_calendar),
      resumen,
      doctores,
      user: req.session.user,
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
}

function citaAEvento(cita, color) {
  const inicio = new Date(cita.fecha_hora_inicio);
  const fin = new Date(inicio.getTime() + cita.duracion_minutos * 60000);
  return {
    id: cita.id,
    title: `${cita.mascota_nombre} — ${cita.doctor_apellidos}, ${cita.doctor_nombre}`,
    start: inicio.toISOString(),
    end: fin.toISOString(),
    backgroundColor: color.hex ?? undefined,
    borderColor: color.hex ?? undefined,
    // Los colores de Google Calendar son fondos pastel/claros incluso los
    // "oscuros" — texto blanco encima no pasa contraste mínimo, Google usa
    // #1d1d1d para los 11 (ver googleCalendarColors.js).
    textColor: color.foreground ?? undefined,
    extendedProps: {
      doctorId: cita.doctor_id,
      mascotaId: cita.mascota_id,
      motivo: cita.motivo ?? '',
      estado: cita.estado,
    },
  };
}

// GET /agenda/:slug/citas.json?start=&end() — feed que FullCalendar pide
// automáticamente al navegar semana/día (opción `events: { url }`).
async function eventos(req, res, next) {
  try {
    const citas = await service.listarEventos(req.area.id, {
      desde: req.query.start,
      hasta: req.query.end,
      doctorId: req.query.doctorId,
    });
    const color = findColor(req.area.color_google_calendar);
    res.json(citas.map((cita) => citaAEvento(cita, color)));
  } catch (err) {
    next(err);
  }
}

// GET /agenda/:slug/citas/nueva — fragmento HTMX, formulario vacío. `inicio`
// (query) precarga la fecha/hora si se abrió haciendo clic en un slot del
// calendario (ver agenda.ejs).
async function nuevoForm(req, res, next) {
  try {
    const doctores = await service.listarDoctoresDelArea(req.area.id);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/cita-form', {
      area: req.area,
      cita: null,
      doctores,
      doctorIdSeleccionado: '',
      mascotaSeleccionada: null,
      fechaHoraInicio: req.query.inicio ?? '',
      duracionMinutos: '',
      motivo: '',
      error: null,
      soloLectura: false,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// GET /agenda/:slug/citas/:id/editar — fragmento HTMX, formulario
// precargado. Pedido explícito del usuario: una cita que ya pasó (por
// fecha_hora_inicio, mismo criterio que "pasadas" en resumenDelDia) se abre
// en solo lectura — se puede consultar pero no editar, para que nadie se
// "agencie" citas ya ocurridas cambiando doctor/mascota/motivo después.
async function editarForm(req, res, next) {
  try {
    const cita = await service.obtener(req.params.id);
    if (!cita || cita.area_id !== req.area.id) {
      return res.status(404).send('Cita no encontrada');
    }
    const soloLectura = new Date(cita.fecha_hora_inicio) < new Date();
    const [doctores, mascotaSeleccionada] = await Promise.all([
      service.listarDoctoresDelArea(req.area.id),
      tutoresService.resolverMascota(cita.mascota_id),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/cita-form', {
      area: req.area,
      cita,
      doctores,
      doctorIdSeleccionado: cita.doctor_id,
      mascotaSeleccionada,
      fechaHoraInicio: new Date(cita.fecha_hora_inicio).toISOString(),
      duracionMinutos: String(cita.duracion_minutos),
      motivo: cita.motivo ?? '',
      error: null,
      soloLectura,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

// Tras alta/edición exitosa: a diferencia de áreas/plantillas (que
// refrescan una tabla vía swap out-of-band), aquí no hay tabla que
// swapear — el propio calendario ES la vista. El HX-Trigger le avisa al JS
// del cliente que cierre el modal Y le pida a FullCalendar
// `refetchEvents()` (ver agenda.ejs).
function renderExito(req, res) {
  res.set('HX-Trigger', 'closeCitaModal');
  res.send('');
}

// US: alta — nace `confirmada` (ver agenda.service.js#crear). Un error de
// validación/traslape/doctor-fuera-de-área no truena: re-renderiza el mismo
// formulario con el mensaje, conservando doctor/mascota ya elegidos (mismo
// criterio que usuarios.controller.js#crear con `resolverDoctor`).
async function crear(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    await service.crear({
      areaId: req.area.id,
      doctorId: req.body.doctorId,
      mascotaId: req.body.mascotaId,
      fechaHoraInicio: req.body.fechaHoraInicio,
      duracionMinutos: req.body.duracionMinutos,
      motivo: req.body.motivo,
      usuarioId: req.session.user.id,
    });
  } catch (err) {
    if (err.status) {
      const [doctores, mascotaSeleccionada] = await Promise.all([
        service.listarDoctoresDelArea(req.area.id),
        tutoresService.resolverMascota(req.body.mascotaId),
      ]);
      return res.render('partials/cita-form', {
        area: req.area,
        cita: null,
        doctores,
        doctorIdSeleccionado: req.body.doctorId ?? '',
        mascotaSeleccionada,
        fechaHoraInicio: req.body.fechaHoraInicio ?? '',
        duracionMinutos: req.body.duracionMinutos ?? '',
        motivo: req.body.motivo ?? '',
        error: err.message,
        soloLectura: false,
        csrfToken,
        user: req.session.user,
      });
    }
    return next(err);
  }
  return renderExito(req, res);
}

// PUT /agenda/:slug/citas/:id — edición. Mismo manejo de error que crear(),
// pero conservando la cita original en el formulario re-renderizado (sigue
// en modo edición).
async function editar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing || existing.area_id !== req.area.id) {
      return res.status(404).send('Cita no encontrada');
    }
    // Defensa en profundidad: el formulario ya se abre en solo lectura
    // (sin botón Guardar) para una cita pasada — esto solo cubre un
    // request directo o una cita que pasó de futura a pasada mientras el
    // modal seguía abierto.
    if (new Date(existing.fecha_hora_inicio) < new Date()) {
      return res.status(403).send('No se puede editar una cita que ya pasó.');
    }

    try {
      await service.editar({
        id: req.params.id,
        areaId: req.area.id,
        doctorId: req.body.doctorId,
        mascotaId: req.body.mascotaId,
        fechaHoraInicio: req.body.fechaHoraInicio,
        duracionMinutos: req.body.duracionMinutos,
        motivo: req.body.motivo,
        usuarioId: req.session.user.id,
      });
    } catch (err) {
      if (err.status) {
        const [doctores, mascotaSeleccionada] = await Promise.all([
          service.listarDoctoresDelArea(req.area.id),
          tutoresService.resolverMascota(req.body.mascotaId),
        ]);
        return res.render('partials/cita-form', {
          area: req.area,
          cita: existing,
          doctores,
          doctorIdSeleccionado: req.body.doctorId ?? '',
          mascotaSeleccionada,
          fechaHoraInicio: req.body.fechaHoraInicio ?? '',
          duracionMinutos: req.body.duracionMinutos ?? '',
          motivo: req.body.motivo ?? '',
          error: err.message,
          soloLectura: false,
          csrfToken,
          user: req.session.user,
        });
      }
      throw err;
    }

    return renderExito(req, res);
  } catch (err) {
    return next(err);
  }
}

// DELETE /agenda/:slug/citas/:id — "eliminar" en la UI es cancelar (baja
// lógica, nunca DELETE físico).
async function cancelar(req, res, next) {
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing || existing.area_id !== req.area.id) {
      return res.status(404).send('Cita no encontrada');
    }
    await service.cancelar(req.params.id, req.session.user.id);
    return renderExito(req, res);
  } catch (err) {
    return next(err);
  }
}

module.exports = { attachArea, pagina, eventos, nuevoForm, editarForm, crear, editar, cancelar };
