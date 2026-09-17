const db = require('../../config/database');

function baseQuery({ q, activoOnly }) {
  return db('plantillas_whatsapp as p').modify((builder) => {
    if (activoOnly) builder.where('p.activo', true);
    if (q) {
      builder.where((b) => {
        b.whereRaw('p.intencion ILIKE ?', [`%${q}%`])
          .orWhereRaw('p.slug ILIKE ?', [`%${q}%`])
          .orWhereRaw('p.texto_respuesta ILIKE ?', [`%${q}%`]);
      });
    }
  });
}

async function count({ q, activoOnly }) {
  const row = await baseQuery({ q, activoOnly }).count('p.id as total').first();
  return Number(row.total);
}

const SORT_EXPRESSIONS = {
  intencion: (dir) => `p.intencion ${dir}`,
  slug: (dir) => `p.slug ${dir}`,
  estado_meta: (dir) => `p.aprobado_meta ${dir}`,
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
    .select(
      'p.id',
      'p.intencion',
      'p.slug',
      'p.aprobado_meta',
      'p.categoria_meta',
      'p.activo',
      'p.es_predeterminada',
    );
}

async function existsAny() {
  const row = await db('plantillas_whatsapp').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

async function findById(id) {
  return db('plantillas_whatsapp').where({ id }).first();
}

async function findAllExcept() {
  return db('plantillas_whatsapp').select(
    'id',
    'intencion',
    'activo',
    'slug',
    'texto_respuesta',
    'categoria_meta',
  );
}

async function existsBySlug(slug) {
  const row = await db('plantillas_whatsapp').where({ slug }).first();
  return Boolean(row);
}

async function create({
  intencion,
  slug,
  texto_respuesta,
  categoriaMeta,
  esEmergencia,
  usuarioId,
}) {
  const [row] = await db('plantillas_whatsapp')
    .insert({
      intencion,
      slug,
      texto_respuesta,
      categoria_meta: categoriaMeta,
      es_emergencia: esEmergencia,
      activo: true,
      veces_usada: 0,
      creado_por: usuarioId,
      creado_en: db.fn.now(),
    })
    .returning('id');
  return row.id;
}

async function update(id, { texto_respuesta, activo, esEmergencia, usuarioId }) {
  await db.transaction(async (trx) => {
    const actual = await trx('plantillas_whatsapp').where({ id }).first('activo');

    const cambios = {
      texto_respuesta,
      es_emergencia: esEmergencia,
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

async function desactivar(id, usuarioId) {
  await db('plantillas_whatsapp').where({ id }).update({
    activo: false,
    desactivado_por: usuarioId,
    desactivado_en: db.fn.now(),
  });
}

async function findActivasParaClasificar() {
  return db('plantillas_whatsapp')
    .where('activo', true)
    .where('es_predeterminada', false)
    .select('id', 'intencion', 'slug', 'texto_respuesta');
}

async function findBySlug(slug) {
  return db('plantillas_whatsapp').where({ slug }).first();
}

async function incrementarUso(id, trx) {
  const conexion = trx ?? db;
  await conexion('plantillas_whatsapp')
    .where({ id })
    .update({ veces_usada: conexion.raw('veces_usada + 1') });
}

async function findParaSincronizarMeta() {
  return db('plantillas_whatsapp')
    .whereNot('categoria_meta', 'TEXTO_LIBRE')
    .select('id', 'slug', 'categoria_meta', 'aprobado_meta');
}

async function actualizarDatosMeta(id, { categoriaMeta, aprobadoMeta }) {
  const cambios = { aprobado_meta: aprobadoMeta };
  if (categoriaMeta) cambios.categoria_meta = categoriaMeta;
  await db('plantillas_whatsapp').where({ id }).update(cambios);
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
  findActivasParaClasificar,
  incrementarUso,
  findParaSincronizarMeta,
  actualizarDatosMeta,
  findBySlug,
};
