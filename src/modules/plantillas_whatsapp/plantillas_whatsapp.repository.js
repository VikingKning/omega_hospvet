// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias). Mismo
// patrón que doctores.repository.js/areas.repository.js (tabla estándar
// del sistema), pero sin join: "plantillas_whatsapp" no tiene una relación
// hija que aplanar.
const db = require('../../config/database');

function baseQuery({ q, activoOnly }) {
  return db('plantillas_whatsapp as p').modify((builder) => {
    if (activoOnly) builder.where('p.activo', true);
    // Busca por intención o por slug — mismo criterio que
    // areas.repository.js#baseQuery (nombre o slug), útil ahora que el
    // slug se le puede compartir a quien configure el matching del LLM.
    if (q) {
      builder.where((b) => {
        b.whereRaw('p.intencion ILIKE ?', [`%${q}%`]).orWhereRaw('p.slug ILIKE ?', [`%${q}%`]);
      });
    }
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
  slug: (dir) => `p.slug ${dir}`,
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
    .select('p.id', 'p.intencion', 'p.slug', 'p.veces_usada', 'p.activo');
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

// Trae todas las filas activas o no para que el service compare
// intenciones normalizadas (sin acentos/mayúsculas/espacios) en JS — mismo
// criterio que areas.repository.js#findAllExcept: el catálogo es chico, y
// así se evita pelear con collations/extensiones de Postgres (ver el fix
// de duplicados de áreas, US-610). Sin parámetro de exclusión: a
// diferencia de áreas, aquí solo la revisa crear() (intención/slug son
// inmutables después del alta, editar() ya no compara duplicados).
async function findAllExcept() {
  return db('plantillas_whatsapp').select('id', 'intencion', 'activo');
}

// El slug es único de verdad para siempre (nunca se reutiliza, ni siquiera
// por una plantilla desactivada) — mismo criterio que areas.repository.js
// #existsBySlug.
async function existsBySlug(slug) {
  const row = await db('plantillas_whatsapp').where({ slug }).first();
  return Boolean(row);
}

// US-613 AC: alta — activo=true, veces_usada=0 siempre (nunca lo manda el
// formulario). `slug` se genera en el service y nunca vuelve a cambiar
// (ver el comentario de la migración 20260824000002).
async function create({ intencion, slug, texto_respuesta, usuarioId }) {
  const [row] = await db('plantillas_whatsapp')
    .insert({
      intencion,
      slug,
      texto_respuesta,
      activo: true,
      veces_usada: 0,
      creado_por: usuarioId,
      creado_en: db.fn.now(),
    })
    .returning('id');
  return row.id;
}

// US-613 (ampliada): edición — SOLO texto_respuesta +
// actualizado_por/actualizado_en; veces_usada nunca se toca aquí, y
// tampoco intencion/slug (inmutables tras el alta — decisión explícita del
// usuario: la identidad de la plantilla que el LLM matchea no puede
// cambiar de significado bajo el mismo id sin dejar mensajes históricos
// mal interpretados; para "cambiar la intención" hay que dar de baja esta
// plantilla y crear una nueva). El switch Activo/Inactivo del formulario
// de edición vive en esta misma pantalla (a petición explícita, no estaba
// en el AC original de la historia) — la transición se calcula contra el
// valor actual en la base DENTRO de una transacción (no contra lo que el
// formulario cargó al abrirse), fijando/limpiando
// desactivado_por/desactivado_en exactamente igual que
// doctores.repository.js#editar.
async function update(id, { texto_respuesta, activo, usuarioId }) {
  await db.transaction(async (trx) => {
    const actual = await trx('plantillas_whatsapp').where({ id }).first('activo');

    const cambios = {
      texto_respuesta,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    };

    if (actual.activo && !activo) {
      cambios.activo = false;
      cambios.desactivado_por = usuarioId;
      cambios.desactivado_en = trx.fn.now();
    } else if (!actual.activo && activo) {
      cambios.activo = true;
      cambios.desactivado_por = null;
      cambios.desactivado_en = null;
    }

    await trx('plantillas_whatsapp').where({ id }).update(cambios);
  });
}

// US-613 (alta con intención reutilizada de una plantilla dada de baja): en
// vez de un INSERT que chocaría con el UNIQUE de `intencion`, se reactiva
// el registro desactivado que ya tenía esa intención — mismo patrón que
// areas.repository.js#reactivar. Distinto del switch Activo/Inactivo de
// editar(): este reactivar() es específico del ALTA (nombre reutilizado),
// no de la edición de un registro ya identificado por id.
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

// US-614: baja lógica, nunca DELETE físico — se conserva el historial de
// uso (veces_usada) y de mensajes ya enviados con esta plantilla. Mismo
// patrón que doctores/areas.repository.js#desactivar.
async function desactivar(id, usuarioId) {
  await db('plantillas_whatsapp').where({ id }).update({
    activo: false,
    desactivado_por: usuarioId,
    desactivado_en: db.fn.now(),
  });
}

module.exports = {
  count,
  findPage,
  existsAny,
  findById,
  findAllExcept,
  existsBySlug,
  create,
  update,
  reactivar,
  desactivar,
};
