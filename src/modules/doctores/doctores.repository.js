// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias).
const db = require('../../config/database');

// El filtro de búsqueda por doctor o área debe decidir QUÉ doctores entran
// al resultado sin restringir qué áreas se les muestran (un doctor que
// coincide por el nombre de una sola área debe seguir mostrando todas sus
// áreas). Por eso el texto de búsqueda se aplica en un WHERE sobre IDs de
// doctor ya resueltos, antes del LEFT JOIN + agregación de áreas.
function matchingDoctorIdsQuery(q) {
  return db('doctores as d')
    .distinct('d.id')
    .leftJoin('doctor_area as da', 'da.doctor_id', 'd.id')
    .leftJoin('areas as a', 'a.id', 'da.area_id')
    .where((builder) => {
      builder
        .whereRaw('d.nombre ILIKE ?', [`%${q}%`])
        .orWhereRaw('d.apellidos ILIKE ?', [`%${q}%`])
        .orWhereRaw('a.nombre ILIKE ?', [`%${q}%`]);
    });
}

function baseQuery({ q, activoOnly }) {
  return db('doctores as d').modify((builder) => {
    if (activoOnly) builder.where('d.activo', true);
    if (q) builder.whereIn('d.id', matchingDoctorIdsQuery(q));
  });
}

async function count({ q, activoOnly }) {
  const row = await baseQuery({ q, activoOnly }).count('d.id as total').first();
  return Number(row.total);
}

// Whitelist fija de expresiones ordenables por columna del header — nunca se
// arma el ORDER BY con el valor de `sort`/`dir` tal cual llega del query
// string, siempre se resuelve contra este mapa primero (mismo principio que
// el resto del repository: nunca concatenar SQL con datos de entrada). Cada
// entrada recibe la dirección ya validada y la aplica a TODAS sus columnas
// (p.ej. "doctor" ordena por apellidos y nombre, ambos en la misma
// dirección) — pegar la dirección solo al final rompería el desempate en
// expresiones de más de una columna. El orden de "areas" ordena por el
// mismo string_agg que se muestra en la columna, no por el nombre de una
// sola área.
const SORT_EXPRESSIONS = {
  doctor: (dir) => `d.apellidos ${dir}, d.nombre ${dir}`,
  areas: (dir) => `string_agg(a.nombre, ', ' order by a.nombre) ${dir}`,
  estado: (dir) => `d.activo ${dir}`,
};

function applySort(query, { sort, dir }) {
  const direction = dir === 'desc' ? 'desc' : 'asc';
  const buildExpression = SORT_EXPRESSIONS[sort] ?? SORT_EXPRESSIONS.doctor;
  return query.orderByRaw(buildExpression(direction));
}

async function findPage({ q, activoOnly, sort, dir, limit, offset }) {
  const rows = await applySort(
    baseQuery({ q, activoOnly })
      .leftJoin('doctor_area as da', 'da.doctor_id', 'd.id')
      .leftJoin('areas as a', 'a.id', 'da.area_id')
      .groupBy('d.id'),
    { sort, dir },
  )
    .limit(limit)
    .offset(offset)
    .select('d.id', 'd.nombre', 'd.apellidos', 'd.activo')
    .select(db.raw("string_agg(a.nombre, ', ' order by a.nombre) as areas"));

  return rows;
}

// Independiente de filtros: distingue "el catálogo nunca ha tenido un
// doctor" (mockup sin toolbar, solo el estado vacío con CTA) de "esta
// búsqueda no encontró nada" (mockup con toolbar y tabla vacía).
async function existsAny() {
  const row = await db('doctores').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

// US-608: baja lógica, nunca DELETE físico — se conserva el historial de
// citas/laboratorio que referencia este doctor.
async function desactivar(id, usuarioId) {
  await db('doctores').where({ id }).update({
    activo: false,
    desactivado_por: usuarioId,
    desactivado_en: db.fn.now(),
  });
}

// US-607: para precargar el formulario de edición.
async function findById(id) {
  return db('doctores').where({ id }).first();
}

// Especialidades YA asignadas a un doctor — se muestran en la tabla del
// formulario aunque el área haya sido desactivada después de la asignación
// (a diferencia del picker de abajo, que solo ofrece áreas activas para
// agregar; una ya asignada no desaparece de la tabla solo porque el área en
// sí se dio de baja después).
async function findAreasByDoctorId(doctorId) {
  return db('doctor_area as da')
    .join('areas as a', 'a.id', 'da.area_id')
    .where('da.doctor_id', doctorId)
    .orderBy('a.nombre')
    .select('a.id', 'a.nombre');
}

// Catálogo para el <select> de "Especialidades" del formulario — solo
// áreas activas, mismo criterio que el resto del sistema para no ofrecer
// asignar algo dado de baja.
async function listAreasActivas() {
  return db('areas').where({ activo: true }).orderBy('nombre').select('id', 'nombre');
}

// Resuelve id -> nombre para volver a pintar la tabla de especialidades en
// un re-render por error (el usuario ya había armado su selección, no hay
// que perderla) — sin filtrar por activo, por la misma razón que
// findAreasByDoctorId.
async function findAreasByIds(ids) {
  if (!ids.length) return [];
  return db('areas').whereIn('id', ids).orderBy('nombre').select('id', 'nombre');
}

// Agenda: dirección área -> doctores (todo lo demás en este archivo va
// doctor -> áreas). Solo doctores activos, para el combobox de "Doctor" del
// formulario de citas — un doctor dado de baja no debe poder recibir citas
// nuevas aunque siga ligado a `doctor_area` (esa fila se conserva por
// historial, mismo criterio que el resto del sistema).
async function findActivosByAreaId(areaId) {
  return db('doctor_area as da')
    .join('doctores as d', 'd.id', 'da.doctor_id')
    .where('da.area_id', areaId)
    .andWhere('d.activo', true)
    .orderBy(['d.apellidos', 'd.nombre'])
    .select('d.id', 'd.nombre', 'd.apellidos');
}

// US-607 AC: alta — inserta el doctor y una fila en doctor_area por cada
// área seleccionada (puede ser ninguna), todo en una sola transacción: si
// el insert de doctor_area fallara (p.ej. un id de área que ya no existe),
// el doctor tampoco debe quedar creado a medias.
async function crear({ nombre, apellidos, activo, areaIds, usuarioId }) {
  return db.transaction(async (trx) => {
    const [row] = await trx('doctores')
      .insert({ nombre, apellidos, activo, creado_por: usuarioId, creado_en: trx.fn.now() })
      .returning('id');

    if (areaIds.length) {
      await trx('doctor_area').insert(
        areaIds.map((areaId) => ({ doctor_id: row.id, area_id: areaId })),
      );
    }

    return row.id;
  });
}

// US-607 AC: edición — actualiza doctores (nombre/apellidos/activo +
// actualizado_por/actualizado_en) y sustituye por completo las filas de
// doctor_area por la selección actual (borra todas e inserta las
// seleccionadas) — logra el mismo resultado que "agregar las nuevas y
// quitar las que ya no están" sin necesidad de diffear fila por fila,
// porque doctor_area no tiene columnas propias que valga la pena
// preservar. El activo se compara contra el valor actual DENTRO de la
// misma transacción (no el que el controller pudo haber leído antes) para
// decidir si hay que fijar/limpiar desactivado_por/desactivado_en — mismo
// criterio que activar/desactivar en el resto del sistema: esas columnas
// solo se tocan en una transición real, no en cada guardado.
async function editar({ id, nombre, apellidos, activo, areaIds, usuarioId }) {
  await db.transaction(async (trx) => {
    const actual = await trx('doctores').where({ id }).first('activo');

    const update = {
      nombre,
      apellidos,
      activo,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    };

    if (actual.activo && !activo) {
      update.desactivado_por = usuarioId;
      update.desactivado_en = trx.fn.now();
    } else if (!actual.activo && activo) {
      update.desactivado_por = null;
      update.desactivado_en = null;
    }

    await trx('doctores').where({ id }).update(update);

    await trx('doctor_area').where({ doctor_id: id }).del();
    if (areaIds.length) {
      await trx('doctor_area').insert(
        areaIds.map((areaId) => ({ doctor_id: id, area_id: areaId })),
      );
    }
  });
}

module.exports = {
  count,
  findPage,
  existsAny,
  desactivar,
  findById,
  findAreasByDoctorId,
  findActivosByAreaId,
  listAreasActivas,
  findAreasByIds,
  crear,
  editar,
};
