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
    .select('a.id', 'a.nombre', 'a.slug', 'a.activo', 'a.color_google_calendar');
}

// Independiente de filtros: distingue "el catálogo nunca ha tenido un área"
// (empty state con CTA) de "esta búsqueda no encontró nada" (toolbar +
// tabla vacía) — mismo criterio que doctores.repository.js.
async function existsAny() {
  const row = await db('areas').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

// US-611: baja lógica, nunca DELETE físico — se conservan las citas
// históricas que referencian esta área.
async function desactivar(id, usuarioId) {
  await db('areas').where({ id }).update({
    activo: false,
    desactivado_por: usuarioId,
    desactivado_en: db.fn.now(),
  });
}

// US-610: para precargar el formulario de edición (nombre + slug read-only).
async function findById(id) {
  return db('areas').where({ id }).first();
}

// Agenda: resuelve la página genérica /agenda/:slug.html contra un área
// real — trae también `color_google_calendar` (el controller la usa para
// pintar los eventos del calendario de esa área).
async function findBySlug(slug) {
  return db('areas').where({ slug }).first();
}

// Trae todas las filas (menos la propia, en edición) para que el service
// compare nombres normalizados (sin acentos/mayúsculas/espacios) en JS — el
// catálogo es chico, así que no vale la pena pelear con collations o
// instalar la extensión `unaccent` de Postgres (que además sería tocar el
// schema del cliente) solo para este chequeo.
async function findAllExcept(excludeId) {
  return db('areas')
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .select('id', 'nombre', 'activo');
}

// El slug SÍ es único de verdad para siempre, sin importar el estado — así
// nunca se reutiliza uno ya usado por un área desactivada, para no romper
// vistas/enlaces históricos que lo hayan referenciado.
async function existsBySlug(slug) {
  const row = await db('areas').where({ slug }).first();
  return Boolean(row);
}

// Auto-provisión de permisos de agenda: cada área activa necesita sus
// propios 5 permisos `agenda_<slug>.<accion>` para poder aparecer en el
// tab "Agendas" de la matriz de permisos (usuarios.service.js#construirTabAgendas
// empareja por `modulo`) y, desde la reconstrucción del sidebar, en el menú
// de navegación real (`agenda.<slug>.ver`). Mismo shape que genera
// 01_permissions.js#agendaPermissions para las 8 áreas fijas — duplicado a
// propósito (ese archivo es un seed de arranque que solo corre una vez;
// esto es código de producción que corre en cada alta/reactivación real,
// mismo criterio de independencia entre piezas ya aplicado en el resto del
// proyecto). Si 01_permissions.js cambia el patrón de código/descripción,
// esta función debe actualizarse en conjunto.
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

// onConflict('codigo').ignore() (la única columna UNIQUE de `permissions`)
// — idempotente a propósito: create() nunca debería chocar (el slug
// siempre es nuevo, ver generateUniqueSlug en el service), pero
// reactivar() sí puede toparse con un área que ya tenía sus permisos
// provisionados de antes (las 8 áreas fijas de 06_areas_agenda.js, cuyos
// permisos vienen de 01_permissions.js, no de esta función) — nunca debe
// tronar ni duplicar filas.
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

// El slug nunca se toca aquí — a propósito, así lo pide la historia.
async function updateNombre(id, nombre, color, usuarioId) {
  await db('areas').where({ id }).update({
    nombre,
    color_google_calendar: color,
    actualizado_por: usuarioId,
    actualizado_en: db.fn.now(),
  });
}

// US-610 (alta con nombre reutilizado): en vez de un INSERT que chocaría
// con el UNIQUE de `nombre` del script original, se reactiva el registro
// desactivado que ya tenía ese nombre — conserva su slug de siempre (nunca
// se regenera) y limpia desactivado_por/desactivado_en. `nombre` se
// reescribe con lo que el usuario acaba de escribir (mismo valor salvo
// mayúsculas/espacios, por si acaso). También asegura sus permisos de
// agenda (idempotente): un área dada de alta antes de que existiera esta
// auto-provisión pudo quedar sin ellos.
async function reactivar(id, nombre, color, usuarioId) {
  await db.transaction(async (trx) => {
    const area = await trx('areas').where({ id }).first('slug');
    await trx('areas').where({ id }).update({
      nombre,
      color_google_calendar: color,
      activo: true,
      // null explícito para limpiar la columna — undefined la deja intacta.
      desactivado_por: null,
      desactivado_en: null,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    });
    await asegurarPermisosAgenda(trx, area.slug, nombre);
  });
}

module.exports = {
  count,
  findPage,
  existsAny,
  desactivar,
  findById,
  findBySlug,
  findAllExcept,
  existsBySlug,
  create,
  updateNombre,
  reactivar,
};
