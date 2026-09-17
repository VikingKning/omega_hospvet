const db = require('../../config/database');

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
    .select('d.id', 'd.nombre', 'd.apellidos', 'd.activo', 'd.es_predeterminado')
    .select(db.raw("string_agg(a.nombre, ', ' order by a.nombre) as areas"));

  return rows;
}

async function existsAny() {
  const row = await db('doctores').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

async function desactivar(id, usuarioId) {
  await db('doctores').where({ id }).update({
    activo: false,
    desactivado_por: usuarioId,
    desactivado_en: db.fn.now(),
  });
}

async function findById(id) {
  return db('doctores').where({ id }).first();
}

async function findAreasByDoctorId(doctorId) {
  return db('doctor_area as da')
    .join('areas as a', 'a.id', 'da.area_id')
    .where('da.doctor_id', doctorId)
    .orderBy('a.nombre')
    .select('a.id', 'a.nombre');
}

async function listAreasActivas() {
  return db('areas').where({ activo: true }).orderBy('nombre').select('id', 'nombre');
}

async function findAreasByIds(ids) {
  if (!ids.length) return [];
  return db('areas').whereIn('id', ids).orderBy('nombre').select('id', 'nombre');
}

async function findActivosByAreaId(areaId) {
  return db('doctor_area as da')
    .join('doctores as d', 'd.id', 'da.doctor_id')
    .where('da.area_id', areaId)
    .andWhere('d.activo', true)
    .orderBy(['d.apellidos', 'd.nombre'])
    .select('d.id', 'd.nombre', 'd.apellidos');
}

async function findActivos() {
  return db('doctores')
    .where('activo', true)
    .orderBy(['apellidos', 'nombre'])
    .select('id', 'nombre', 'apellidos');
}

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
  findActivos,
  listAreasActivas,
  findAreasByIds,
  crear,
  editar,
};
