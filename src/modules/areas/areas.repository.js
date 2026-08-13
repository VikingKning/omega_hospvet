// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias). Mismo
// patrón que doctores.repository.js (tabla estándar del sistema), pero sin
// join/agregación: "areas" no tiene una relación hija que aplanar.
const db = require('../../config/database');

function baseQuery({ q, activoOnly }) {
  return db('areas as a').modify((builder) => {
    if (activoOnly) builder.where('a.activo', true);
    if (q) {
      builder.where((b) => {
        b.whereRaw('a.nombre ILIKE ?', [`%${q}%`]).orWhereRaw('a.slug ILIKE ?', [`%${q}%`]);
      });
    }
  });
}

async function count({ q, activoOnly }) {
  const row = await baseQuery({ q, activoOnly }).count('a.id as total').first();
  return Number(row.total);
}

// Whitelist fija de expresiones ordenables por columna del header — nunca se
// arma el ORDER BY con el valor de `sort`/`dir` tal cual llega del query
// string (mismo principio que doctores.repository.js).
const SORT_EXPRESSIONS = {
  nombre: (dir) => `a.nombre ${dir}`,
  slug: (dir) => `a.slug ${dir}`,
  estado: (dir) => `a.activo ${dir}`,
};

function applySort(query, { sort, dir }) {
  const direction = dir === 'desc' ? 'desc' : 'asc';
  const buildExpression = SORT_EXPRESSIONS[sort] ?? SORT_EXPRESSIONS.nombre;
  return query.orderByRaw(buildExpression(direction));
}

async function findPage({ q, activoOnly, sort, dir, limit, offset }) {
  return applySort(baseQuery({ q, activoOnly }), { sort, dir })
    .limit(limit)
    .offset(offset)
    .select('a.id', 'a.nombre', 'a.slug', 'a.activo');
}

// Independiente de filtros: distingue "el catálogo nunca ha tenido un área"
// (empty state con CTA) de "esta búsqueda no encontró nada" (toolbar +
// tabla vacía) — mismo criterio que doctores.repository.js.
async function existsAny() {
  const row = await db('areas').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

module.exports = { count, findPage, existsAny };
