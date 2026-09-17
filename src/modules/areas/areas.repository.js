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
    .select(
      'a.id',
      'a.nombre',
      'a.slug',
      'a.activo',
      'a.color_google_calendar',
      'a.es_predeterminada',
    );
}

async function existsAny() {
  const row = await db('areas').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

async function desactivar(id, usuarioId) {
  await db('areas').where({ id }).update({
    activo: false,
    desactivado_por: usuarioId,
    desactivado_en: db.fn.now(),
  });
}

async function findById(id) {
  return db('areas').where({ id }).first();
}

async function findBySlug(slug) {
  return db('areas').where({ slug }).first();
}

async function findAllExcept(excludeId) {
  return db('areas')
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .select('id', 'nombre', 'activo');
}

async function existsBySlug(slug) {
  const row = await db('areas').where({ slug }).first();
  return Boolean(row);
}

const AGENDA_ACCIONES = [
  ['ver', 'Ver'],
  ['crear', 'Agendar'],
  ['editar', 'Editar'],
  ['cancelar', 'Cancelar'],
  ['confirmar', 'Confirmar'],
];

function permisosAgendaDelArea(slug, nombre) {
  return AGENDA_ACCIONES.map(([accion, accionLabel]) => ({
    modulo: `agenda_${slug}`,
    accion,
    codigo: `agenda.${slug}.${accion}`,
    descripcion: `${accionLabel} citas de ${nombre}`,
  }));
}

async function asegurarPermisosAgenda(trx, slug, nombre) {
  await trx('permissions')
    .insert(permisosAgendaDelArea(slug, nombre))
    .onConflict('codigo')
    .ignore();
}

async function create({ nombre, slug, color, usuarioId }) {
  return db.transaction(async (trx) => {
    const [row] = await trx('areas')
      .insert({
        nombre,
        slug,
        color_google_calendar: color,
        creado_por: usuarioId,
        creado_en: trx.fn.now(),
      })
      .returning('id');

    await asegurarPermisosAgenda(trx, slug, nombre);

    return row.id;
  });
}

async function updateNombre(id, nombre, color, usuarioId) {
  await db('areas').where({ id }).update({
    nombre,
    color_google_calendar: color,
    actualizado_por: usuarioId,
    actualizado_en: db.fn.now(),
  });
}

async function reactivar(id, nombre, color, usuarioId) {
  await db.transaction(async (trx) => {
    const area = await trx('areas').where({ id }).first('slug');
    await trx('areas').where({ id }).update({
      nombre,
      color_google_calendar: color,
      activo: true,
      desactivado_por: null,
      desactivado_en: null,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    });
    await asegurarPermisosAgenda(trx, area.slug, nombre);
  });
}

async function activar(id, usuarioId) {
  await db.transaction(async (trx) => {
    const area = await trx('areas').where({ id }).first('slug', 'nombre');
    if (!area) return;
    await trx('areas').where({ id }).update({
      activo: true,
      desactivado_por: null,
      desactivado_en: null,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    });
    await asegurarPermisosAgenda(trx, area.slug, area.nombre);
  });
}

module.exports = {
  count,
  findPage,
  existsAny,
  desactivar,
  activar,
  findById,
  findBySlug,
  findAllExcept,
  existsBySlug,
  create,
  updateNombre,
  reactivar,
};
