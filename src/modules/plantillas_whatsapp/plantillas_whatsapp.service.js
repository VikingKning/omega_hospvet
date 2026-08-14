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

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['intencion', 'veces_usada', 'estado'];
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
// AC de esta historia (a diferencia de doctores/áreas): el filtro por
// defecto es "Todos", no "Activos" — así que `activoOnly` solo se activa
// cuando el usuario pide explícitamente estado=activos, no al revés.
async function list({ q, estado, page: rawPage, sort: rawSort, dir: rawDir }) {
  const trimmedQ = (q ?? '').trim();
  const activoOnly = estado === 'activos';
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
// doctores/areas.service.js#desactivar).
async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
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

// Trae todas las plantillas (menos excludeId, en edición) y compara
// intenciones normalizadas en JS — ver el comentario de
// repository.findAllExcept sobre por qué no se hace con SQL/una extensión
// de Postgres.
async function findDuplicado(intencion, excludeId) {
  const objetivo = normalizeIntencion(intencion);
  const candidatos = await repository.findAllExcept(excludeId);
  return candidatos.find((candidato) => normalizeIntencion(candidato.intencion) === objetivo);
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
    await repository.reactivar(existing.id, intencion, usuarioId);
    return existing.id;
  }

  return repository.create({ intencion, texto_respuesta, usuarioId });
}

// El switch Activo/Inactivo del formulario solo viaja en el body cuando
// está marcado (comportamiento estándar de un <input type="checkbox">) —
// su ausencia significa "Inactivo", no un valor inválido que rechazar.
// Mismo criterio que doctores.service.js#parseActivo.
function parseActivo(rawActivo) {
  return rawActivo === 'true';
}

// US-613 AC (ampliada): edición — con id, actualiza intención/texto_respuesta
// y el estado Activo/Inactivo (switch agregado a petición explícita del
// usuario, no estaba en el AC original de la historia), conserva
// veces_usada. A diferencia de crear(), aquí SÍ se rechaza contra CUALQUIER
// otro registro con esa intención, esté activo o no — mismo criterio que
// areas.service.js#editar (no hay "reactivar por nombre" al editar; el
// switch de esta misma pantalla ya cubre reactivar/desactivar por id).
async function editar({
  id,
  intencion: rawIntencion,
  texto_respuesta: rawTexto,
  activo: rawActivo,
  usuarioId,
}) {
  const intencion = validateTexto(rawIntencion, 'Intención', INTENCION_MAX_LENGTH);
  const texto_respuesta = validateTexto(rawTexto, 'Texto de respuesta');
  const activo = parseActivo(rawActivo);

  const existing = await findDuplicado(intencion, id);
  if (existing) {
    throw new DuplicateIntencionError();
  }

  await repository.update(id, { intencion, texto_respuesta, activo, usuarioId });
}

module.exports = {
  list,
  obtener,
  desactivar,
  crear,
  editar,
  PlantillaValidationError,
  DuplicateIntencionError,
};
