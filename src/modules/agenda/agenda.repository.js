// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias). `citas` es
// la fuente de verdad de la agenda; Google Calendar (cuando se conecte) es
// solo espejo — no se toca ninguna API externa desde aquí.
const db = require('../../config/database');

// `duracion_minutos` es un entero, no un segundo timestamp — el "fin" de
// una cita se calcula sumando el intervalo en SQL en vez de guardarlo
// aparte, así nunca puede desincronizarse de `duracion_minutos` si alguien
// edita la duración.
const FIN_EXPR = db.raw("fecha_hora_inicio + (duracion_minutos * interval '1 minute')");

function baseQuery(areaId) {
  return db('citas as c').where('c.area_id', areaId).andWhereNot('c.estado', 'cancelada');
}

function conDetalle(query) {
  return query
    .join('mascotas as m', 'm.id', 'c.mascota_id')
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

// Feed del calendario (FullCalendar pide start/end al navegar semana/día) y
// también la base del resumen del día (el service le pasa el rango de
// "hoy" y clasifica pasadas/pendientes comparando contra `new Date()`).
// Traslape con el rango, no solo `fecha_hora_inicio` dentro de él — una
// cita que empezó antes de `desde` pero todavía no termina también debe
// aparecer. `doctorId` es opcional (pedido explícito del usuario: filtrar
// el calendario por un doctor de la sección, además de área+rango) — sin
// filtro cuando no se manda, mismo criterio que `excludeId` en
// existeTraslape.
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

// Bloques "ocupado" de un doctor en OTRAS áreas (pedido explícito del
// usuario: al filtrar el calendario por un doctor, marcar en gris sus
// horas ya ocupadas "entre calendarios" — un doctor puede atender varias
// áreas, y una cita en OTRA área lo bloquea igual). `excludeAreaId` es el
// área que se está viendo — sus propias citas de este doctor ya se ven con
// detalle real vía findEnRango, no hace falta duplicarlas aquí. Sin JOIN ni
// detalle (mascota/motivo) a propósito: es solo una franja "ocupado", no
// información de una cita que el usuario quizá no tiene permiso de ver.
async function findOcupadoPorDoctor(doctorId, desde, hasta, excludeAreaId) {
  return db('citas')
    .where('doctor_id', doctorId)
    .andWhereNot('estado', 'cancelada')
    .andWhereNot('area_id', excludeAreaId)
    .andWhere('fecha_hora_inicio', '<', hasta)
    .andWhere(FIN_EXPR, '>', desde)
    .select('id', 'fecha_hora_inicio', 'duracion_minutos');
}

// "Siguiente cita": la más próxima a partir de ahora, sin acotar a hoy (si
// ya no queda ninguna hoy, es la primera de mañana) — mismo criterio que la
// tarjeta "próxima cita" del mockup que esto reemplaza.
async function findSiguiente(areaId, ahora) {
  return conDetalle(baseQuery(areaId).andWhere('c.fecha_hora_inicio', '>=', ahora))
    .orderBy('c.fecha_hora_inicio', 'asc')
    .first();
}

// Traslape: mismo doctor, rango de horario que se cruza con una cita ya
// existente (no cancelada). `excludeId` se usa en edición, para no chocar
// consigo misma.
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

// Alta desde el portal: siempre nace `confirmada` (decisión explícita del
// usuario — el personal la agenda directamente, no hace falta un paso de
// confirmar lo que uno mismo acaba de crear) y `origen='portal'` (el
// origen `whatsapp`, que sí nacería `registrada`, es de una fase futura).
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

// Editar: puede reagendar (fecha/hora/doctor), cambiar de mascota o motivo
// — nunca toca `estado` (decisión explícita del usuario, "editar" y
// "confirmar" son acciones separadas).
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

// "Eliminar" en la UI es cancelar — baja lógica, nunca DELETE físico
// (mismo patrón que todo el resto del sistema): la fila se conserva para
// el histórico de `mensajes_whatsapp`/métricas.
async function cancelar(id, usuarioId) {
  await db('citas').where({ id }).update({
    estado: 'cancelada',
    cancelado_por: usuarioId,
    cancelado_en: db.fn.now(),
  });
}

module.exports = {
  findEnRango,
  findOcupadoPorDoctor,
  findSiguiente,
  existeTraslape,
  findById,
  create,
  update,
  cancelar,
};
