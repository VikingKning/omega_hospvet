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

module.exports = { count, findPage, existsAny, desactivar };
