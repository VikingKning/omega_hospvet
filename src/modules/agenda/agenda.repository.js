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

// Detalle completo de una cita para armar el evento de Google
// (agenda.googleSync.js#pushCita) — mascota+doctor+color del área. A
// diferencia de conDetalle() (que asume un area_id externo, ya filtrado en
// baseQuery), esta trae el area_id/color desde la propia fila: el push no
// vive dentro del contexto de "esta área" como el resto del repository.
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

// Sincronización con Google Calendar (agenda.googleSync.js) — citas que le
// "deben" un push: nunca se les intentó (sin google_event_id, futura, no
// cancelada), se editaron después del último push exitoso, o se
// cancelaron después del último push exitoso (todavía tienen
// google_event_id, hay que borrar el evento allá). La misma función cubre
// TANTO el push inmediato (si falló) como los reintentos del job — es la
// única fuente de "qué le debo a Google todavía".
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

// Citas ya reflejadas en Google — para diffear contra lo que reporta el
// pull (agenda.googleSync.js#sincronizar) y detectar cancelaciones o
// reagendados hechos directo ahí. Solo futuras y no canceladas de este
// lado (una ya cancelada aquí no tiene nada que reconciliar).
async function findSincronizadasFuturas(ahora) {
  return db('citas')
    .whereNotNull('google_event_id')
    .andWhereNot('estado', 'cancelada')
    .andWhere('fecha_hora_inicio', '>=', ahora)
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

// Reagendado hecho DIRECTO en Google Calendar — se aplica tal cual, sin
// pasar por las validaciones de negocio de agenda.service.js#editar
// (traslape/doctor-en-área): para este cambio puntual, Google ya es la
// fuente de verdad (pedido explícito del usuario). google_sincronizado_en
// se actualiza también, para no reprocesar el mismo cambio en el
// siguiente ciclo del job.
async function aplicarReagendoDesdeGoogle(id, { fechaHoraInicio, duracionMinutos }) {
  await db('citas').where({ id }).update({
    fecha_hora_inicio: fechaHoraInicio,
    duracion_minutos: duracionMinutos,
    google_sincronizado_en: db.fn.now(),
  });
}

// Cancelación hecha DIRECTO en Google Calendar — misma baja lógica que
// cancelar() de abajo, pero sin `cancelado_por` (nadie del sistema la
// canceló) y marcando google_sincronizado_en para no reprocesarla.
async function aplicarCancelacionDesdeGoogle(id) {
  await db('citas').where({ id }).update({
    estado: 'cancelada',
    cancelado_en: db.fn.now(),
    google_sincronizado_en: db.fn.now(),
  });
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
  findByIdParaSync,
  findPendientesDePush,
  findSincronizadasFuturas,
  marcarSincronizado,
  aplicarReagendoDesdeGoogle,
  aplicarCancelacionDesdeGoogle,
  create,
  update,
  cancelar,
};
