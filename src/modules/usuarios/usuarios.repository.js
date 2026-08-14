// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias). Mismo
// patrón que doctores.repository.js (tabla estándar del sistema): un LEFT
// JOIN simple a doctores (1 a 1 vía usuarios.doctor_id), sin agregación —
// a diferencia de doctores↔áreas, aquí no hay relación muchos-a-muchos que
// aplanar.
const db = require('../../config/database');

function baseQuery({ q, estatus }) {
  return db('usuarios as u').modify((builder) => {
    if (estatus) builder.where('u.estatus', estatus);
    if (q) {
      builder.where((b) => {
        b.whereRaw('u.nombre ILIKE ?', [`%${q}%`])
          .orWhereRaw('u.apellidos ILIKE ?', [`%${q}%`])
          .orWhereRaw('u.username ILIKE ?', [`%${q}%`])
          .orWhereRaw('u.correo ILIKE ?', [`%${q}%`]);
      });
    }
  });
}

async function count({ q, estatus }) {
  const row = await baseQuery({ q, estatus }).count('u.id as total').first();
  return Number(row.total);
}

// Whitelist fija de expresiones ordenables por columna del header — nunca se
// arma el ORDER BY con el valor de `sort`/`dir` tal cual llega del query
// string (mismo principio que doctores/areas/plantillas_whatsapp.repository.js).
// "nombre" ordena por apellidos+nombre, igual que "doctor" en
// doctores.repository.js — la columna de la tabla muestra el nombre
// completo, no el campo `nombre` a secas.
const SORT_EXPRESSIONS = {
  nombre: (dir) => `u.apellidos ${dir}, u.nombre ${dir}`,
  username: (dir) => `u.username ${dir}`,
  correo: (dir) => `u.correo ${dir}`,
  estatus: (dir) => `u.estatus ${dir}`,
};

function applySort(query, { sort, dir }) {
  const direction = dir === 'desc' ? 'desc' : 'asc';
  const buildExpression = SORT_EXPRESSIONS[sort] ?? SORT_EXPRESSIONS.nombre;
  return query.orderByRaw(buildExpression(direction));
}

async function findPage({ q, estatus, sort, dir, limit, offset }) {
  return applySort(baseQuery({ q, estatus }).leftJoin('doctores as d', 'd.id', 'u.doctor_id'), {
    sort,
    dir,
  })
    .limit(limit)
    .offset(offset)
    .select(
      'u.id',
      'u.nombre',
      'u.apellidos',
      'u.username',
      'u.correo',
      'u.estatus',
      'd.nombre as doctor_nombre',
      'd.apellidos as doctor_apellidos',
    );
}

// Independiente de filtros: distingue "el catálogo nunca ha tenido un
// usuario" (imposible en la práctica, siempre hay al menos el admin
// bootstrap de US-000, pero se deja por consistencia con el resto del
// sistema) de "esta búsqueda no encontró nada".
async function existsAny() {
  const row = await db('usuarios').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

module.exports = { count, findPage, existsAny };
