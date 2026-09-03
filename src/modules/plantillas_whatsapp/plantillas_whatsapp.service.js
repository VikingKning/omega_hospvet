const logger = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const repository = require('./plantillas_whatsapp.repository');

// Mismo patrón de errores con `.status` que areas.service.js — el
// controller los atrapa para re-renderizar el formulario con el mensaje,
// en vez de un 400/409 JSON crudo (esto es un fragmento HTMX, no una API).
class PlantillaValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class DuplicateIntencionError extends Error {
  constructor() {
    super('La intención ya está registrada.');
    this.status = 409;
  }
}

// Las 4 plantillas predeterminadas del sistema (migración 20260903000002)
// son inborrables — pedido explícito del usuario, son la respuesta de
// respaldo que usa whatsapp.service.js para las categorías sin acción
// real todavía, nunca deben poder quedar en 0.
class PlantillaPredeterminadaError extends Error {
  constructor() {
    super('Esta es una plantilla predeterminada del sistema y no se puede eliminar.');
    this.status = 400;
  }
}

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['intencion', 'slug', 'estado_meta', 'estado'];
const INTENCION_MAX_LENGTH = 100;

function parsePage(rawPage) {
  const page = Number.parseInt(rawPage, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSort(rawSort) {
  return SORT_COLUMNS.includes(rawSort) ? rawSort : 'intencion';
}

function parseDir(rawDir) {
  return rawDir === 'desc' ? 'desc' : 'asc';
}

// Query params de un listado GET: se sanean con valores por defecto en vez
// de rechazarse con un error (mismo criterio que doctores/areas.service.js).
//
// Cambio explícito del usuario (2026-09-03): el filtro por defecto ahora
// es "Activos", igual que doctores/áreas — antes era "Todos" (AC original
// de US-612). `activoOnly` solo se desactiva cuando se pide
// explícitamente estado=todos.
async function list({ q, estado, page: rawPage, sort: rawSort, dir: rawDir }) {
  const trimmedQ = (q ?? '').trim();
  const activoOnly = estado !== 'todos';
  const page = parsePage(rawPage);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = { q: trimmedQ || undefined, activoOnly };

  const [plantillas, total, catalogoVacio] = await Promise.all([
    repository.findPage({ ...filters, sort, dir, limit: PAGE_SIZE, offset }),
    repository.count(filters),
    repository.existsAny().then((exists) => !exists),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    plantillas,
    total,
    catalogoVacio,
    page: Math.min(page, totalPages),
    totalPages,
    pageSize: PAGE_SIZE,
    q: trimmedQ,
    estado: activoOnly ? 'activos' : 'todos',
    sort,
    dir,
  };
}

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// US-613: para precargar el formulario de edición.
async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  return repository.findById(id);
}

// US-614: baja lógica (activo=false + desactivado_por/desactivado_en),
// nunca un DELETE físico — se conserva veces_usada y el historial de
// mensajes enviados con esta plantilla. Un id inválido/inexistente no
// truena, simplemente no hace nada (mismo criterio permisivo que
// doctores/areas.service.js#desactivar). Una plantilla predeterminada del
// sistema (es_predeterminada) SÍ rechaza — es la única validación real de
// esta operación.
async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  const plantilla = await repository.findById(id);
  if (!plantilla) return;
  if (plantilla.es_predeterminada) {
    throw new PlantillaPredeterminadaError();
  }
  await repository.desactivar(id, usuarioId);
}

// Quita acentos/diacríticos para el chequeo de duplicados — mismo criterio
// que areas.service.js#normalizeNombre: "Confirmar cita" y "confirmar  Cita"
// (espacios/mayúsculas/acentos distintos) cuentan como la misma intención.
// Lo que se guarda/muestra es siempre el texto tal cual lo escribió el
// usuario (solo recortado por validateTexto), la normalización es solo
// para decidir si es un duplicado.
const DIACRITIC_MARKS = /[̀-ͯ]/g;

function normalizeIntencion(intencion) {
  return intencion.normalize('NFD').replace(DIACRITIC_MARKS, '').toLowerCase().replace(/\s+/g, '');
}

// Trae todas las plantillas y compara intenciones normalizadas en JS — ver
// el comentario de repository.findAllExcept sobre por qué no se hace con
// SQL/una extensión de Postgres. Solo la usa crear(): intención es
// inmutable tras el alta (ver editar() más abajo), así que editar() ya no
// necesita comparar contra las demás.
async function findDuplicado(intencion) {
  const objetivo = normalizeIntencion(intencion);
  const candidatos = await repository.findAllExcept();
  return candidatos.find((candidato) => normalizeIntencion(candidato.intencion) === objetivo);
}

// Mismo slugify que areas.service.js, duplicado a propósito (módulos de
// dominio independientes entre sí, mismo criterio que
// areas.repository.js#asegurarPermisosAgenda). El slug es la clave que un
// LLM usará para elegir esta plantilla — se genera UNA VEZ al crear y
// nunca se regenera (ver editar() más abajo y la migración
// 20260824000002).
function slugify(intencion) {
  return intencion
    .normalize('NFD')
    .replace(DIACRITIC_MARKS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function generateUniqueSlug(intencion) {
  const base = slugify(intencion);
  let slug = base;
  let suffix = 2;
  // Secuencial a propósito: cada intento depende del resultado del anterior.
  while (await repository.existsBySlug(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function validateTexto(rawValor, etiqueta, maxLength) {
  const valor = (rawValor ?? '').trim();
  if (!valor) {
    throw new PlantillaValidationError(`El campo ${etiqueta} es obligatorio.`);
  }
  if (maxLength && valor.length > maxLength) {
    throw new PlantillaValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

// `intencion` es texto libre (lo escribe el staff) — Meta exige
// minúsculas/números/guion_bajo para el `name` de una plantilla, así que
// se deriva de `slug` (ya normalizado por slugify() de arriba) cambiando
// los guiones por guion_bajo. Exportado: scripts/registrar-plantillas-whatsapp.js
// y plantillas_whatsapp.metaSync.js lo reusan para no duplicarlo.
function nombreMeta(slug) {
  return slug.replace(/-/g, '_');
}

// Alta/reactivación → intenta registrar la plantilla en Meta de inmediato
// (push best-effort, mismo criterio que agenda.googleSync.js#pushCita):
// nunca lanza ni bloquea la operación local — estas plantillas ni
// siquiera necesitan aprobación de Meta para funcionar (son respuestas
// DENTRO de una conversación ya abierta), la aprobación es un tracking
// aparte (Decisión 24/Bitácora v4). Si el POST falla (Meta caído, ya
// registrada, etc.), la plantilla queda con aprobado_meta=false (su
// default) y no hay reintento automático del registro en sí — solo el job
// periódico (plantillas_whatsapp.metaSync.js) revisa si Meta YA la
// aprobó, no si todavía no se registró.
async function registrarEnMeta({ id, slug, texto_respuesta }) {
  if (!whatsapp.isWhatsappConfigured()) return;

  try {
    const res = await fetch(whatsapp.templatesUrl(), {
      method: 'POST',
      headers: whatsapp.authHeaders(),
      body: JSON.stringify({
        name: nombreMeta(slug),
        language: 'es_MX',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: texto_respuesta }],
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      logger.error(
        { plantillaId: id, status: res.status, data },
        'Meta rechazó el registro de la plantilla para aprobación.',
      );
    }
  } catch (err) {
    logger.error({ err, plantillaId: id }, 'No se pudo registrar la plantilla en Meta.');
  }
}

// US-613 AC: alta — sin id. `intencion` sigue siendo única de verdad a
// nivel de base de datos (constraint del script original, sin tocar), así
// que "reutilizar la intención de una plantilla dada de baja" no puede ser
// un INSERT nuevo (chocaría con el UNIQUE). Mismo patrón que
// areas.service.js#crear: si ya existe un registro con esa intención,
// activo -> duplicado real (se rechaza); inactivo -> se reactiva ese mismo
// registro en vez de crear uno paralelo (una plantilla se desactiva desde
// el switch del formulario de edición, ver editar()/repository.js#update).
async function crear({ intencion: rawIntencion, texto_respuesta: rawTexto, usuarioId }) {
  const intencion = validateTexto(rawIntencion, 'Intención', INTENCION_MAX_LENGTH);
  const texto_respuesta = validateTexto(rawTexto, 'Texto de respuesta');

  const existing = await findDuplicado(intencion);
  if (existing) {
    if (existing.activo) {
      throw new DuplicateIntencionError();
    }
    // Reactivación de una plantilla ya dada de baja: el slug original se
    // conserva (nunca se regenera), igual que areas.service.js#crear.
    await repository.reactivar(existing.id, intencion, usuarioId);
    // texto_respuesta NUEVO del formulario, ojo: reactivar() no lo guarda
    // (solo reactivar() en sí toca intencion/activo/desactivado_*), así
    // que Meta se registra con el texto YA GUARDADO (existing.texto_respuesta),
    // no con lo que se acaba de escribir en este alta.
    await registrarEnMeta({
      id: existing.id,
      slug: existing.slug,
      texto_respuesta: existing.texto_respuesta,
    });
    return existing.id;
  }

  const slug = await generateUniqueSlug(intencion);
  const id = await repository.create({ intencion, slug, texto_respuesta, usuarioId });
  await registrarEnMeta({ id, slug, texto_respuesta });
  return id;
}

// El switch Activo/Inactivo del formulario solo viaja en el body cuando
// está marcado (comportamiento estándar de un <input type="checkbox">) —
// su ausencia significa "Inactivo", no un valor inválido que rechazar.
// Mismo criterio que doctores.service.js#parseActivo.
function parseActivo(rawActivo) {
  return rawActivo === 'true';
}

// US-613 AC (ampliada): edición — con id, actualiza SOLO texto_respuesta y
// el estado Activo/Inactivo (switch agregado a petición explícita del
// usuario, no estaba en el AC original de la historia), conserva
// veces_usada. `intencion`/`slug` son inmutables después del alta —
// decisión explícita del usuario: son la identidad con la que el LLM
// matchea un mensaje de WhatsApp a esta plantilla, y con la que
// mensajes_whatsapp.plantilla_id enlaza el histórico; si se pudieran
// editar, un mensaje viejo quedaría re-interpretado en silencio bajo un
// significado distinto al que tenía cuando realmente se envió. Para
// "cambiar la intención" hay que dar de baja esta plantilla (switch de
// esta misma pantalla) y crear una nueva — nunca reescribir esta. Por eso
// ya no hay chequeo de duplicados aquí (a diferencia de crear()): con
// intención fija, no hay forma de que una edición choque con otra fila.
//
// `esPredeterminada` (lo trae el controller, ya tenía el registro cargado
// para el 404/re-render) fuerza activo=true sin importar lo que mande el
// formulario — las 4 plantillas del sistema son "solo editables" (el
// texto), nunca se pueden desactivar, ni siquiera por este switch (el
// formulario ni lo muestra para estas, ver plantilla-form.ejs, pero esto
// es la defensa real del lado del servidor).
async function editar({
  id,
  texto_respuesta: rawTexto,
  activo: rawActivo,
  esPredeterminada,
  usuarioId,
}) {
  const texto_respuesta = validateTexto(rawTexto, 'Texto de respuesta');
  const activo = esPredeterminada ? true : parseActivo(rawActivo);

  await repository.update(id, { texto_respuesta, activo, usuarioId });
}

module.exports = {
  list,
  obtener,
  desactivar,
  crear,
  editar,
  nombreMeta,
  PlantillaValidationError,
  DuplicateIntencionError,
  PlantillaPredeterminadaError,
};
