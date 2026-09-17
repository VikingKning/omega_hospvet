const repository = require('./areas.repository');
const { isValidColorId, findColor } = require('./googleCalendarColors');

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

  const areasConColor = areas.map((area) => ({
    ...area,
    color: findColor(area.color_google_calendar),
  }));

  return {
    areas: areasConColor,
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

async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.desactivar(id, usuarioId);
}

async function activar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.activar(id, usuarioId);
}

async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  return repository.findById(id);
}

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

function normalizeNombre(nombre) {
  return nombre.normalize('NFD').replace(DIACRITIC_MARKS, '').toLowerCase().replace(/\s+/g, '');
}

async function findDuplicado(nombre, excludeId) {
  const objetivo = normalizeNombre(nombre);
  const candidatos = await repository.findAllExcept(excludeId);
  return candidatos.find((candidato) => normalizeNombre(candidato.nombre) === objetivo);
}

async function generateUniqueSlug(nombre) {
  const base = slugify(nombre);
  let slug = base;
  let suffix = 2;
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

function validateColor(rawColor) {
  return isValidColorId(rawColor) ? String(rawColor) : null;
}

async function crear({ nombre: rawNombre, color: rawColor, usuarioId }) {
  const nombre = validateNombre(rawNombre);
  const color = validateColor(rawColor);
  const existing = await findDuplicado(nombre);

  if (existing) {
    if (existing.activo) {
      throw new DuplicateNombreError();
    }
    await repository.reactivar(existing.id, nombre, color, usuarioId);
    return existing.id;
  }

  const slug = await generateUniqueSlug(nombre);
  return repository.create({ nombre, slug, color, usuarioId });
}

async function editar({ id, nombre: rawNombre, color: rawColor, usuarioId }) {
  const parsedId = parseId(id);
  const actual = parsedId !== null ? await repository.findById(parsedId) : null;
  const color = validateColor(rawColor);

  if (actual?.es_predeterminada) {
    await repository.updateNombre(id, actual.nombre, color, usuarioId);
    return;
  }

  const nombre = validateNombre(rawNombre);
  const existing = await findDuplicado(nombre, id);
  if (existing) {
    throw new DuplicateNombreError();
  }
  await repository.updateNombre(id, nombre, color, usuarioId);
}

module.exports = {
  list,
  desactivar,
  activar,
  obtener,
  crear,
  editar,
  AreaValidationError,
  DuplicateNombreError,
};
