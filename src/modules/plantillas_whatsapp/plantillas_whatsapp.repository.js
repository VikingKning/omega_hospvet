// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias). Mismo
// patrón que doctores.repository.js/areas.repository.js (tabla estándar
// del sistema), pero sin join: "plantillas_whatsapp" no tiene una relación
// hija que aplanar.
const db = require('../../config/database');

function baseQuery({ q, activoOnly }) {
  return db('plantillas_whatsapp as p').modify((builder) => {
    if (activoOnly) builder.where('p.activo', true);
    // Busca por intención, slug o texto de respuesta — mismo criterio que
    // areas.repository.js#baseQuery (nombre o slug), ampliado a petición
    // explícita del usuario: con el catálogo creciendo, a veces se
    // recuerda una frase del texto pero no la intención/slug exactos.
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

// Whitelist fija de expresiones ordenables por columna del header — nunca se
// arma el ORDER BY con el valor de `sort`/`dir` tal cual llega del query
// string (mismo principio que doctores.repository.js/areas.repository.js).
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

// veces_usada ya no se muestra en la tabla (se movió al detalle vía el
// ícono de Ver, ver plantilla-detalle.ejs) — se quita de aquí porque
// findById() (que sí trae todas las columnas) es lo que alimenta esa
// pantalla, no findPage().
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
// slug/texto_respuesta/categoria_meta se incluyen para que crear() pueda
// reintentar el registro en Meta al reactivar una plantilla dada de baja
// (reactivar() no toca texto_respuesta/categoria_meta, así que hay que
// leer lo que ya estaba guardado).
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

// El slug es único de verdad para siempre (nunca se reutiliza, ni siquiera
// por una plantilla desactivada) — mismo criterio que areas.repository.js
// #existsBySlug.
async function existsBySlug(slug) {
  const row = await db('plantillas_whatsapp').where({ slug }).first();
  return Boolean(row);
}

// US-613 AC: alta — activo=true, veces_usada=0 siempre (nunca lo manda el
// formulario). `slug` se genera en el service y nunca vuelve a cambiar
// (ver el comentario de la migración 20260824000002). `categoria_meta` la
// decide el service (por ahora siempre 'TEXTO_LIBRE' — ver
// plantillas_whatsapp.service.js#crear), esta función no le pone un
// default propio para no duplicar esa decisión en 2 lugares.
async function create({ intencion, slug, texto_respuesta, categoriaMeta, usuarioId }) {
  const [row] = await db('plantillas_whatsapp')
    .insert({
      intencion,
      slug,
      texto_respuesta,
      categoria_meta: categoriaMeta,
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

// Módulo `whatsapp/` (clasificador de mensajes entrantes) — lista cerrada
// que se le pasa a claude.js#clasificarMensaje para comparar contra el
// catálogo real. `slug` se incluye porque whatsapp.service.js lo usa para
// armar la etiqueta `plantilla` de la auditoría de envío (sin él, todo
// match del catálogo se auditaría como "respuesta_sin_plantilla").
// es_predeterminada=false a propósito: las 4 plantillas del sistema
// (emergencia_medica, agendar_cita_default, resultados_laboratorio_default,
// sin_coincidencia_default) son el respaldo de las categorías genéricas,
// no intenciones específicas — si entraran aquí, Claude podría matchear
// por error un mensaje cualquiera contra, por ejemplo, "emergencia_medica".
async function findActivasParaClasificar() {
  return db('plantillas_whatsapp')
    .where('activo', true)
    .where('es_predeterminada', false)
    .select('id', 'intencion', 'slug', 'texto_respuesta');
}

// whatsapp.service.js: busca por el slug fijo de una de las 4 plantillas
// predeterminadas del sistema (ver la migración 20260903000002) — a
// diferencia de duda_medica, estas se seleccionan de forma determinista
// por categoria_clasificacion, nunca por el LLM.
async function findBySlug(slug) {
  return db('plantillas_whatsapp').where({ slug }).first();
}

// Cada vez que una plantilla resuelve de verdad un mensaje entrante —
// nunca se había incrementado hasta ahora, la columna existe desde el
// alta original (US-613) sin ningún flujo real que la tocara.
async function incrementarUso(id) {
  await db('plantillas_whatsapp')
    .where({ id })
    .update({ veces_usada: db.raw('veces_usada + 1') });
}

// Sincronización con Meta: se consultan todas las plantillas locales que
// NO sean de texto libre (esas nunca se registraron a propósito, ver
// plantillas_whatsapp.service.js#registrarEnMeta — no tiene caso ni
// gastar la llamada a la API de Meta por ellas), no únicamente las
// pendientes, porque Meta también puede reclasificar una plantilla ya
// aprobada de UTILITY a MARKETING.
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
