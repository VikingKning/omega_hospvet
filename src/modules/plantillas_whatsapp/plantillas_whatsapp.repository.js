// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias). Mismo
// patrón que doctores.repository.js/areas.repository.js (tabla estándar
// del sistema), pero sin join: "plantillas_whatsapp" no tiene una relación
// hija que aplanar.
const db = require('../../config/database');

function baseQuery({ q, activoOnly }) {
  return db('plantillas_whatsapp as p').modify((builder) => {
    if (activoOnly) builder.where('p.activo', true);
    if (q) builder.whereRaw('p.intencion ILIKE ?', [`%${q}%`]);
  });
}

async function count({ q, activoOnly }) {
  const row = await baseQuery({ q, activoOnly }).count('p.id as total').first();
  return Number(row.total);
}

// Whitelist fija de expresiones ordenables por columna del header — nunca se
// arma el ORDER BY con el valor de `sort`/`dir` tal cual llega del query
// string (mismo principio que doctores.repository.js/areas.repository.js).
const SORT_EXPRESSIONS = {
  intencion: (dir) => `p.intencion ${dir}`,
  veces_usada: (dir) => `p.veces_usada ${dir}`,
  estado: (dir) => `p.activo ${dir}`,
};

function applySort(query, { sort, dir }) {
  const direction = dir === 'desc' ? 'desc' : 'asc';
  const buildExpression = SORT_EXPRESSIONS[sort] ?? SORT_EXPRESSIONS.intencion;
  return query.orderByRaw(buildExpression(direction));
}

async function findPage({ q, activoOnly, sort, dir, limit, offset }) {
  return applySort(baseQuery({ q, activoOnly }), { sort, dir })
    .limit(limit)
    .offset(offset)
    .select('p.id', 'p.intencion', 'p.veces_usada', 'p.activo');
}

// Independiente de filtros: distingue "el catálogo nunca ha tenido una
// plantilla" (empty state con CTA) de "esta búsqueda no encontró nada"
// (toolbar + tabla vacía) — mismo criterio que doctores/areas.repository.js.
async function existsAny() {
  const row = await db('plantillas_whatsapp').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

// US-613: para precargar el formulario de edición.
async function findById(id) {
  return db('plantillas_whatsapp').where({ id }).first();
}

// Trae todas las filas (menos la propia, en edición) para que el service
// compare intenciones normalizadas (sin acentos/mayúsculas/espacios) en JS
// — mismo criterio que areas.repository.js#findAllExcept: el catálogo es
// chico, y así se evita pelear con collations/extensiones de Postgres (ver
// el fix de duplicados de áreas, US-610).
async function findAllExcept(excludeId) {
  return db('plantillas_whatsapp')
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .select('id', 'intencion', 'activo');
}

// US-613 AC: alta — activo=true, veces_usada=0 siempre (nunca lo manda el
// formulario).
async function create({ intencion, texto_respuesta, usuarioId }) {
  const [row] = await db('plantillas_whatsapp')
    .insert({
      intencion,
      texto_respuesta,
      activo: true,
      veces_usada: 0,
      creado_por: usuarioId,
      creado_en: db.fn.now(),
    })
    .returning('id');
  return row.id;
}

// US-613 AC: edición — solo intención/texto_respuesta +
// actualizado_por/actualizado_en; veces_usada y activo nunca se tocan aquí.
async function update(id, { intencion, texto_respuesta, usuarioId }) {
  await db('plantillas_whatsapp').where({ id }).update({
    intencion,
    texto_respuesta,
    actualizado_por: usuarioId,
    actualizado_en: db.fn.now(),
  });
}

// US-613 (alta con intención reutilizada de una plantilla dada de baja): en
// vez de un INSERT que chocaría con el UNIQUE de `intencion`, se reactiva
// el registro desactivado que ya tenía esa intención — mismo patrón que
// areas.repository.js#reactivar. Hoy no hay ninguna vía para desactivar una
// plantilla (la baja es una historia futura sin número todavía), así que
// esta rama es código muerto en la práctica, pero se deja lista para
// cuando esa historia exista, consistente con el resto del sistema.
async function reactivar(id, intencion, usuarioId) {
  await db('plantillas_whatsapp').where({ id }).update({
    intencion,
    activo: true,
    desactivado_por: null,
    desactivado_en: null,
    actualizado_por: usuarioId,
    actualizado_en: db.fn.now(),
  });
}

module.exports = {
  count,
  findPage,
  existsAny,
  findById,
  findAllExcept,
  create,
  update,
  reactivar,
};
