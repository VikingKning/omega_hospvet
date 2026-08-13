const repository = require('./areas.repository');

// Mismo patrón de errores con `.status` que auth.service.js — el
// controller los atrapa para re-renderizar el formulario con el mensaje,
// en vez de un 400/409 JSON crudo (esto es un fragmento HTMX, no una API).
class AreaValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class DuplicateNombreError extends Error {
  constructor() {
    super('El nombre del Área ya esta registrada');
    this.status = 409;
  }
}

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['nombre', 'slug', 'estado'];
const NOMBRE_MAX_LENGTH = 100;

function parsePage(rawPage) {
  const page = Number.parseInt(rawPage, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSort(rawSort) {
  return SORT_COLUMNS.includes(rawSort) ? rawSort : 'nombre';
}

function parseDir(rawDir) {
  return rawDir === 'desc' ? 'desc' : 'asc';
}

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Query params de un listado GET: se sanean con valores por defecto en vez
// de rechazarse con un error (mismo criterio que doctores.service.js).
async function list({ q, estado, page: rawPage, sort: rawSort, dir: rawDir }) {
  const trimmedQ = (q ?? '').trim();
  const activoOnly = estado !== 'todos';
  const page = parsePage(rawPage);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = { q: trimmedQ || undefined, activoOnly };

  const [areas, total, catalogoVacio] = await Promise.all([
    repository.findPage({ ...filters, sort, dir, limit: PAGE_SIZE, offset }),
    repository.count(filters),
    repository.existsAny().then((exists) => !exists),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    areas,
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

// US-611: baja lógica (activo=false + desactivado_por/desactivado_en), nunca
// un DELETE físico — las citas históricas siguen referenciando esta área.
// Un id inválido/inexistente no truena, simplemente no hace nada (mismo
// criterio permisivo que el resto del módulo).
async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.desactivar(id, usuarioId);
}

// US-610: para precargar el formulario de edición.
async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  return repository.findById(id);
}

// Quita acentos/diacríticos y cualquier caracter que no sea alfanumérico,
// para un slug legible y estable ("Cardiología" -> "cardiologia").
const DIACRITIC_MARKS = /[̀-ͯ]/g;

function slugify(nombre) {
  return nombre
    .normalize('NFD') // separa "í" en "i" + marca de acento combinable
    .replace(DIACRITIC_MARKS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Para el chequeo de duplicados (no para lo que se guarda/muestra): dos
// nombres cuentan como "el mismo" aunque difieran en acentos, mayúsculas o
// espacios ("Neurología" / "Neurologia" / "neuro logia" son un solo
// nombre). `nombre`/`slug` guardados NUNCA pasan por esto — el usuario ve y
// edita el texto tal cual lo escribió (solo recortado por validateNombre).
function normalizeNombre(nombre) {
  return nombre.normalize('NFD').replace(DIACRITIC_MARKS, '').toLowerCase().replace(/\s+/g, '');
}

// Trae todas las áreas (menos excludeId, en edición) y compara nombres
// normalizados en JS — ver el comentario de repository.findAllExcept sobre
// por qué no se hace con SQL/una extensión de Postgres.
async function findDuplicado(nombre, excludeId) {
  const objetivo = normalizeNombre(nombre);
  const candidatos = await repository.findAllExcept(excludeId);
  return candidatos.find((candidato) => normalizeNombre(candidato.nombre) === objetivo);
}

// El slug es único de verdad para siempre. `nombre` también es único
// (constraint del script de base de datos, sin partial index), así que dos
// slugs solo pueden colisionar si dos NOMBRES DISTINTOS normalizan al mismo
// texto (ej. "Área X" y "Área  X" con doble espacio) — caso raro pero se
// cubre igual con un sufijo numérico, mismo patrón que un slug de blog.
async function generateUniqueSlug(nombre) {
  const base = slugify(nombre);
  let slug = base;
  let suffix = 2;
  // Secuencial a propósito: cada intento depende del resultado del anterior.
  while (await repository.existsBySlug(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function validateNombre(rawNombre) {
  const nombre = (rawNombre ?? '').trim();
  if (!nombre) {
    throw new AreaValidationError('El nombre del área es obligatorio.');
  }
  if (nombre.length > NOMBRE_MAX_LENGTH) {
    throw new AreaValidationError(
      `El nombre no puede tener más de ${NOMBRE_MAX_LENGTH} caracteres.`,
    );
  }
  return nombre;
}

// US-610 AC: alta — sin id, genera el slug a partir del nombre. `nombre`
// sigue siendo único de verdad a nivel de base de datos (constraint del
// script original, sin partial index agregado) — así que "reutilizar el
// nombre de un área dada de baja" no puede ser un INSERT nuevo (chocaría
// con el UNIQUE). En vez de eso, si ya existe un registro con ese nombre:
// - activo -> es un duplicado real, se rechaza (AC de duplicados).
// - inactivo -> se REACTIVA ese mismo registro (conserva su slug de
//   siempre, nunca se regenera ni se crea una fila nueva) en vez de crear
//   uno paralelo con un slug con sufijo.
async function crear({ nombre: rawNombre, usuarioId }) {
  const nombre = validateNombre(rawNombre);
  const existing = await findDuplicado(nombre);

  if (existing) {
    if (existing.activo) {
      throw new DuplicateNombreError();
    }
    await repository.reactivar(existing.id, nombre, usuarioId);
    return existing.id;
  }

  const slug = await generateUniqueSlug(nombre);
  return repository.create({ nombre, slug, usuarioId });
}

// US-610 AC: edición — con id, actualiza solo nombre (+ actualizado_por/
// actualizado_en), el slug nunca se toca. A diferencia de crear(), aquí SÍ
// se rechaza contra CUALQUIER otro registro con ese nombre, esté activo o
// no — el `UNIQUE` de la base de datos lo exige de todos modos (no hay
// "reactivar" al editar: sería fusionar la identidad de dos registros
// distintos, algo que el AC nunca pidió).
async function editar({ id, nombre: rawNombre, usuarioId }) {
  const nombre = validateNombre(rawNombre);
  const existing = await findDuplicado(nombre, id);
  if (existing) {
    throw new DuplicateNombreError();
  }
  await repository.updateNombre(id, nombre, usuarioId);
}

module.exports = {
  list,
  desactivar,
  obtener,
  crear,
  editar,
  AreaValidationError,
  DuplicateNombreError,
};
