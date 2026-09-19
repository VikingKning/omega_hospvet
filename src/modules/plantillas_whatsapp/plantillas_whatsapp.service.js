const logger = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const { normalizarFormatoWhatsapp } = require('../../../public/js/whatsapp-format');
const repository = require('./plantillas_whatsapp.repository');

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

class PlantillaPredeterminadaError extends Error {
  constructor() {
    super('Esta es una plantilla predeterminada del sistema y no se puede eliminar.');
    this.status = 400;
  }
}

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['intencion', 'slug', 'estado_meta', 'estado'];
const INTENCION_MAX_LENGTH = 100;
const TEXTO_RESPUESTA_MAX_LENGTH = 550;

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

async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  return repository.findById(id);
}

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

const DIACRITIC_MARKS = /[̀-ͯ]/g;

function normalizeIntencion(intencion) {
  return intencion.normalize('NFD').replace(DIACRITIC_MARKS, '').toLowerCase().replace(/\s+/g, '');
}

async function findDuplicado(intencion) {
  const objetivo = normalizeIntencion(intencion);
  const candidatos = await repository.findAllExcept();
  return candidatos.find((candidato) => normalizeIntencion(candidato.intencion) === objetivo);
}

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
  if (maxLength && Array.from(valor).length > maxLength) {
    throw new PlantillaValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

function nombreMeta(slug) {
  return slug.replace(/-/g, '_');
}

const CATEGORIA_TEXTO_LIBRE = 'TEXTO_LIBRE';

async function registrarEnMeta({ id, slug, texto_respuesta, categoria_meta }) {
  if (categoria_meta === CATEGORIA_TEXTO_LIBRE) return;
  if (!whatsapp.isWhatsappConfigured()) return;

  try {
    const res = await fetch(whatsapp.templatesUrl(), {
      method: 'POST',
      headers: whatsapp.authHeaders(),
      body: JSON.stringify({
        name: nombreMeta(slug),
        language: 'es_MX',
        category: categoria_meta,
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

async function crear({
  intencion: rawIntencion,
  texto_respuesta: rawTexto,
  categoria_meta: rawCategoriaMeta,
  es_emergencia: rawEsEmergencia,
  usuarioId,
}) {
  const intencion = validateTexto(rawIntencion, 'Intención', INTENCION_MAX_LENGTH);
  const texto_respuesta = validateTexto(
    normalizarFormatoWhatsapp(rawTexto),
    'Texto de respuesta',
    TEXTO_RESPUESTA_MAX_LENGTH,
  );
  const categoria_meta = rawCategoriaMeta || CATEGORIA_TEXTO_LIBRE;
  const esEmergencia = parseActivo(rawEsEmergencia);

  const existing = await findDuplicado(intencion);
  if (existing) {
    if (existing.activo) {
      throw new DuplicateIntencionError();
    }
    await repository.reactivar(existing.id, intencion, usuarioId);
    await registrarEnMeta({
      id: existing.id,
      slug: existing.slug,
      texto_respuesta: existing.texto_respuesta,
      categoria_meta: existing.categoria_meta,
    });
    return existing.id;
  }

  const slug = await generateUniqueSlug(intencion);
  const id = await repository.create({
    intencion,
    slug,
    texto_respuesta,
    categoriaMeta: categoria_meta,
    esEmergencia,
    usuarioId,
  });
  await registrarEnMeta({ id, slug, texto_respuesta, categoria_meta });
  return id;
}

function parseActivo(rawActivo) {
  return rawActivo === 'true';
}

async function editar({
  id,
  texto_respuesta: rawTexto,
  activo: rawActivo,
  es_emergencia: rawEsEmergencia,
  esPredeterminada,
  usuarioId,
}) {
  const texto_respuesta = validateTexto(
    normalizarFormatoWhatsapp(rawTexto),
    'Texto de respuesta',
    TEXTO_RESPUESTA_MAX_LENGTH,
  );
  const activo = esPredeterminada ? true : parseActivo(rawActivo);
  const esEmergencia = parseActivo(rawEsEmergencia);

  await repository.update(id, { texto_respuesta, activo, esEmergencia, usuarioId });
}

module.exports = {
  list,
  obtener,
  desactivar,
  crear,
  editar,
  nombreMeta,
  CATEGORIA_TEXTO_LIBRE,
  PlantillaValidationError,
  DuplicateIntencionError,
  PlantillaPredeterminadaError,
};
