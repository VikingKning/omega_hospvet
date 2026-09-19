const service = require('./agenda.service');
const tutoresService = require('../tutores/tutores.service');
const { generateCsrfToken } = require('../../config/csrf');
const { findColor } = require('../areas/googleCalendarColors');

async function resolverTutorParaFormulario({ mascotaSeleccionada, propietarioId }) {
  if (mascotaSeleccionada) {
    return tutoresService.resolverTutorPorId(mascotaSeleccionada.propietario_id);
  }
  if (propietarioId) {
    return tutoresService.resolverTutorPorId(propietarioId);
  }
  return null;
}

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
  const mascotaLabel = cita.mascota_nombre ?? 'Reserva por completar';
  return {
    id: cita.id,
    title: `${mascotaLabel} — ${cita.doctor_apellidos}, ${cita.doctor_nombre}`,
    start: inicio.toISOString(),
    end: fin.toISOString(),
    backgroundColor: color.hex ?? undefined,
    borderColor: color.hex ?? undefined,
    textColor: color.foreground ?? undefined,
    extendedProps: {
      doctorId: cita.doctor_id,
      mascotaId: cita.mascota_id,
      motivo: cita.motivo ?? '',
      estado: cita.estado,
    },
  };
}

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

async function ocupado(req, res, next) {
  try {
    const bloques = await service.listarOcupado(req.area.id, {
      desde: req.query.start,
      hasta: req.query.end,
      doctorId: req.query.doctorId,
    });
    res.json(
      bloques.map((cita) => {
        const inicio = new Date(cita.fecha_hora_inicio);
        const fin = new Date(inicio.getTime() + cita.duracion_minutos * 60000);
        return {
          id: `ocupado-${cita.id}`,
          start: inicio.toISOString(),
          end: fin.toISOString(),
          display: 'background',
        };
      }),
    );
  } catch (err) {
    next(err);
  }
}

async function nuevoForm(req, res, next) {
  try {
    const doctores = await service.listarDoctoresDelArea(req.area.id);
    const doctorIdSeleccionado = doctores.some((d) => String(d.id) === req.query.doctorId)
      ? req.query.doctorId
      : '';
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/cita-form', {
      area: req.area,
      cita: null,
      doctores,
      doctorIdSeleccionado,
      tutorSeleccionado: null,
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
    const tutorSeleccionado = await resolverTutorParaFormulario({
      mascotaSeleccionada,
      propietarioId: cita.propietario_id,
    });
    const csrfToken = generateCsrfToken(req, res);
    res.render('partials/cita-form', {
      area: req.area,
      cita,
      doctores,
      doctorIdSeleccionado: cita.doctor_id,
      tutorSeleccionado,
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

function renderExito(req, res) {
  res.set('HX-Trigger', 'closeCitaModal');
  res.send('');
}

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
      const tutorSeleccionado = await resolverTutorParaFormulario({ mascotaSeleccionada });
      return res.render('partials/cita-form', {
        area: req.area,
        cita: null,
        doctores,
        doctorIdSeleccionado: req.body.doctorId ?? '',
        tutorSeleccionado,
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

async function editar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing || existing.area_id !== req.area.id) {
      return res.status(404).send('Cita no encontrada');
    }
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
        const tutorSeleccionado = await resolverTutorParaFormulario({
          mascotaSeleccionada,
          propietarioId: existing.propietario_id,
        });
        return res.render('partials/cita-form', {
          area: req.area,
          cita: existing,
          doctores,
          doctorIdSeleccionado: req.body.doctorId ?? '',
          tutorSeleccionado,
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

async function confirmar(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    const existing = await service.obtener(req.params.id);
    if (!existing || existing.area_id !== req.area.id) {
      return res.status(404).send('Cita no encontrada');
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
      await service.confirmar(req.params.id, req.session.user.id);
    } catch (err) {
      if (err.status) {
        const [doctores, mascotaSeleccionada] = await Promise.all([
          service.listarDoctoresDelArea(req.area.id),
          tutoresService.resolverMascota(req.body.mascotaId),
        ]);
        const tutorSeleccionado = await resolverTutorParaFormulario({
          mascotaSeleccionada,
          propietarioId: existing.propietario_id,
        });
        return res.render('partials/cita-form', {
          area: req.area,
          cita: existing,
          doctores,
          doctorIdSeleccionado: req.body.doctorId ?? '',
          tutorSeleccionado,
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

module.exports = {
  attachArea,
  pagina,
  eventos,
  ocupado,
  nuevoForm,
  editarForm,
  crear,
  editar,
  cancelar,
  confirmar,
};
