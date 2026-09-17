const db = require('../../config/database');

const INICIO_LOCAL = "timezone('America/Mexico_City', c.fecha_hora_inicio)";
function baseQuery({ desde, hasta, areaId, doctorId }) {
  return db('citas as c')
    .whereRaw(`${INICIO_LOCAL}::date >= ?`, [desde])
    .andWhereRaw(`${INICIO_LOCAL}::date <= ?`, [hasta])
    .modify((builder) => {
      if (areaId) builder.andWhere('c.area_id', areaId);
      if (doctorId) builder.andWhere('c.doctor_id', doctorId);
    });
}

async function listarAreas() {
  return db('areas').where('activo', true).orderBy('nombre').select('id', 'nombre');
}

async function listarDoctores() {
  return db('doctores')
    .where('activo', true)
    .orderBy(['nombre', 'apellidos'])
    .select('id', 'nombre', 'apellidos');
}

async function contarPorDiaArea(rango) {
  return baseQuery(rango)
    .join('areas as a', 'a.id', 'c.area_id')
    .groupByRaw(`${INICIO_LOCAL}::date`)
    .groupBy('a.id', 'a.nombre')
    .orderByRaw(`${INICIO_LOCAL}::date`)
    .select(db.raw(`${INICIO_LOCAL}::date as fecha`), 'a.nombre as area')
    .count({ total: 'c.id' });
}

async function contarPorDia(rango) {
  return baseQuery(rango)
    .groupByRaw(`${INICIO_LOCAL}::date`)
    .orderByRaw(`${INICIO_LOCAL}::date`)
    .select(db.raw(`${INICIO_LOCAL}::date as fecha`))
    .count({ total: 'c.id' });
}

async function contarPorArea(rango) {
  return baseQuery(rango)
    .join('areas as a', 'a.id', 'c.area_id')
    .groupBy('a.id', 'a.nombre')
    .select('a.nombre')
    .count({ total: 'c.id' })
    .orderBy('total', 'desc');
}

async function contarPorDoctor(rango) {
  return baseQuery(rango)
    .join('doctores as d', 'd.id', 'c.doctor_id')
    .groupBy('d.id', 'd.nombre', 'd.apellidos')
    .select('d.nombre', 'd.apellidos')
    .count({ total: 'c.id' })
    .orderBy('total', 'desc');
}

async function contarPorEspecie(rango) {
  const especie = "coalesce(nullif(initcap(trim(m.tipo)), ''), 'Sin especie')";
  return baseQuery(rango)
    .leftJoin('mascotas as m', 'm.id', 'c.mascota_id')
    .groupByRaw(especie)
    .select(db.raw(`${especie} as nombre`))
    .count({ total: 'c.id' })
    .orderBy('total', 'desc');
}

async function contarPorDiaSemana(rango) {
  return baseQuery(rango)
    .groupByRaw(`extract(isodow from ${INICIO_LOCAL})`)
    .select(db.raw(`extract(isodow from ${INICIO_LOCAL})::int as dia_semana`))
    .count({ total: 'c.id' });
}

async function contarPorDuracion(rango) {
  return baseQuery(rango)
    .groupBy('c.duracion_minutos')
    .orderBy('c.duracion_minutos')
    .select('c.duracion_minutos as minutos')
    .count({ total: 'c.id' });
}

async function contarPorDiaHora(rango) {
  return baseQuery(rango)
    .groupByRaw(`extract(isodow from ${INICIO_LOCAL})`)
    .groupByRaw(`extract(hour from ${INICIO_LOCAL})`)
    .orderByRaw(`extract(isodow from ${INICIO_LOCAL})`)
    .orderByRaw(`extract(hour from ${INICIO_LOCAL})`)
    .select(
      db.raw(`extract(isodow from ${INICIO_LOCAL})::int as dia_semana`),
      db.raw(`extract(hour from ${INICIO_LOCAL})::int as hora`),
    )
    .count({ total: 'c.id' });
}

async function contarPorAreaDoctor(rango) {
  return baseQuery(rango)
    .join('areas as a', 'a.id', 'c.area_id')
    .join('doctores as d', 'd.id', 'c.doctor_id')
    .groupBy('a.id', 'a.nombre', 'd.id', 'd.nombre', 'd.apellidos')
    .select('a.nombre as area', 'd.nombre', 'd.apellidos')
    .count({ total: 'c.id' })
    .orderBy('total', 'desc');
}

module.exports = {
  listarAreas,
  listarDoctores,
  contarPorDia,
  contarPorDiaArea,
  contarPorArea,
  contarPorDoctor,
  contarPorEspecie,
  contarPorDiaSemana,
  contarPorDuracion,
  contarPorDiaHora,
  contarPorAreaDoctor,
};
