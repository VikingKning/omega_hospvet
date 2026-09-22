const db = require('../../config/database');

const FIN_EXPR = db.raw("fecha_hora_inicio + (duracion_minutos * interval '1 minute')");

function baseQuery(areaId) {
  return db('citas as c').where('c.area_id', areaId).andWhereNot('c.estado', 'cancelada');
}

function conDetalle(query) {
  return query
    .leftJoin('mascotas as m', 'm.id', 'c.mascota_id')
    .join('doctores as d', 'd.id', 'c.doctor_id')
    .select(
      'c.id',
      'c.fecha_hora_inicio',
      'c.duracion_minutos',
      'c.motivo',
      'c.estado',
      'c.doctor_id',
      'd.nombre as doctor_nombre',
      'd.apellidos as doctor_apellidos',
      'c.mascota_id',
      'm.nombre as mascota_nombre',
    );
}

async function findEnRango(areaId, desde, hasta, doctorId) {
  return conDetalle(
    baseQuery(areaId)
      .andWhere('c.fecha_hora_inicio', '<', hasta)
      .andWhere(FIN_EXPR, '>', desde)
      .modify((builder) => {
        if (doctorId) builder.andWhere('c.doctor_id', doctorId);
      }),
  ).orderBy('c.fecha_hora_inicio');
}

async function findOcupadoPorDoctor(doctorId, desde, hasta, excludeAreaId) {
  return db('citas')
    .where('doctor_id', doctorId)
    .andWhereNot('estado', 'cancelada')
    .andWhereNot('area_id', excludeAreaId)
    .andWhere('fecha_hora_inicio', '<', hasta)
    .andWhere(FIN_EXPR, '>', desde)
    .select('id', 'fecha_hora_inicio', 'duracion_minutos');
}

async function findSiguiente(areaId, ahora) {
  return conDetalle(baseQuery(areaId).andWhere('c.fecha_hora_inicio', '>=', ahora))
    .orderBy('c.fecha_hora_inicio', 'asc')
    .first();
}

async function existeTraslape(doctorId, inicio, fin, excludeId) {
  const row = await db('citas')
    .where('doctor_id', doctorId)
    .andWhereNot('estado', 'cancelada')
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .andWhere('fecha_hora_inicio', '<', fin)
    .andWhere(FIN_EXPR, '>', inicio)
    .first();
  return Boolean(row);
}

async function findById(id) {
  return db('citas').where({ id }).first();
}

async function findByIdParaSync(id) {
  return db('citas as c')
    .join('mascotas as m', 'm.id', 'c.mascota_id')
    .join('doctores as d', 'd.id', 'c.doctor_id')
    .join('areas as a', 'a.id', 'c.area_id')
    .where('c.id', id)
    .first(
      'c.id',
      'c.fecha_hora_inicio',
      'c.duracion_minutos',
      'c.motivo',
      'c.estado',
      'c.google_event_id',
      'm.nombre as mascota_nombre',
      'd.nombre as doctor_nombre',
      'd.apellidos as doctor_apellidos',
      'a.color_google_calendar',
    );
}

async function findPendientesDePush(ahora) {
  return db('citas as c')
    .where((builder) => {
      builder
        .where((b) =>
          b
            .whereNull('c.google_event_id')
            .andWhereNot('c.estado', 'cancelada')
            .andWhere('c.fecha_hora_inicio', '>=', ahora),
        )
        .orWhere((b) =>
          b
            .whereNotNull('c.google_event_id')
            .andWhereNot('c.estado', 'cancelada')
            .andWhere('c.actualizado_en', '>', db.ref('c.google_sincronizado_en')),
        )
        .orWhere((b) =>
          b
            .whereNotNull('c.google_event_id')
            .andWhere('c.estado', 'cancelada')
            .andWhere('c.cancelado_en', '>', db.ref('c.google_sincronizado_en')),
        );
    })
    .select('c.id');
}

const VENTANA_GRACIA_TRAS_CREAR_MS = 2 * 60 * 1000;

async function findSincronizadasFuturas(ahora) {
  return db('citas')
    .whereNotNull('google_event_id')
    .whereNotNull('mascota_id')
    .andWhereNot('estado', 'cancelada')
    .andWhere('fecha_hora_inicio', '>=', ahora)
    .andWhere('creado_en', '<', new Date(ahora.getTime() - VENTANA_GRACIA_TRAS_CREAR_MS))
    .select(
      'id',
      'google_event_id',
      'fecha_hora_inicio',
      'duracion_minutos',
      'actualizado_en',
      'google_sincronizado_en',
    );
}

async function marcarSincronizado(id, googleEventId) {
  await db('citas').where({ id }).update({
    google_event_id: googleEventId,
    google_sincronizado_en: db.fn.now(),
  });
}

async function aplicarReagendoDesdeGoogle(id, { fechaHoraInicio, duracionMinutos }) {
  await db('citas').where({ id }).update({
    fecha_hora_inicio: fechaHoraInicio,
    duracion_minutos: duracionMinutos,
    google_sincronizado_en: db.fn.now(),
  });
}

async function aplicarCancelacionDesdeGoogle(id) {
  await db('citas').where({ id }).update({
    estado: 'cancelada',
    cancelado_en: db.fn.now(),
    google_sincronizado_en: db.fn.now(),
  });
}

async function create({
  areaId,
  doctorId,
  mascotaId,
  fechaHoraInicio,
  duracionMinutos,
  motivo,
  usuarioId,
}) {
  const [row] = await db('citas')
    .insert({
      area_id: areaId,
      doctor_id: doctorId,
      mascota_id: mascotaId,
      fecha_hora_inicio: fechaHoraInicio,
      duracion_minutos: duracionMinutos,
      motivo,
      estado: 'confirmada',
      origen: 'portal',
      creado_por: usuarioId,
      creado_en: db.fn.now(),
      confirmada_por: usuarioId,
      confirmada_en: db.fn.now(),
    })
    .returning('id');
  return row.id;
}

async function update(
  id,
  { doctorId, mascotaId, fechaHoraInicio, duracionMinutos, motivo, usuarioId },
) {
  await db('citas').where({ id }).update({
    doctor_id: doctorId,
    mascota_id: mascotaId,
    fecha_hora_inicio: fechaHoraInicio,
    duracion_minutos: duracionMinutos,
    motivo,
    actualizado_por: usuarioId,
    actualizado_en: db.fn.now(),
  });
}

async function cancelar(id, usuarioId) {
  await db('citas').where({ id }).update({
    estado: 'cancelada',
    cancelado_por: usuarioId,
    cancelado_en: db.fn.now(),
  });
}

async function findByGoogleEventId(googleEventId) {
  return db('citas').where({ google_event_id: googleEventId }).first();
}

async function obtenerOCrearDoctorPredeterminado({ nombre, apellidos, areaSlug }) {
  let doctor = await db('doctores').where({ nombre, apellidos, es_predeterminado: true }).first();

  if (!doctor) {
    const [row] = await db('doctores')
      .insert({
        nombre,
        apellidos,
        activo: true,
        es_predeterminado: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    doctor = { id: row.id };
  }

  const area = await db('areas').where({ slug: areaSlug }).first();
  if (area) {
    const yaVinculado = await db('doctor_area')
      .where({ doctor_id: doctor.id, area_id: area.id })
      .first();
    if (!yaVinculado) {
      await db('doctor_area').insert({ doctor_id: doctor.id, area_id: area.id });
    }
  }

  return doctor;
}

async function crearDesdeReservaExterna({
  areaId,
  doctorId,
  mascotaId,
  propietarioId,
  fechaHoraInicio,
  duracionMinutos,
  motivo,
  estado,
  googleEventId,
}) {
  const [row] = await db('citas')
    .insert({
      area_id: areaId,
      doctor_id: doctorId,
      mascota_id: mascotaId,
      propietario_id: propietarioId,
      fecha_hora_inicio: fechaHoraInicio,
      duracion_minutos: duracionMinutos,
      motivo,
      estado,
      origen: 'reserva_externa',
      google_event_id: googleEventId,
      creado_en: db.fn.now(),
      ...(estado === 'confirmada' ? { confirmada_en: db.fn.now() } : {}),
    })
    .returning('id');
  return row.id;
}

async function confirmar(id, usuarioId) {
  await db('citas').where({ id }).update({
    estado: 'confirmada',
    confirmada_por: usuarioId,
    confirmada_en: db.fn.now(),
  });
}

module.exports = {
  findEnRango,
  findOcupadoPorDoctor,
  findSiguiente,
  existeTraslape,
  findById,
  findByIdParaSync,
  findPendientesDePush,
  findSincronizadasFuturas,
  marcarSincronizado,
  aplicarReagendoDesdeGoogle,
  aplicarCancelacionDesdeGoogle,
  create,
  update,
  cancelar,
  findByGoogleEventId,
  obtenerOCrearDoctorPredeterminado,
  crearDesdeReservaExterna,
  confirmar,
};
