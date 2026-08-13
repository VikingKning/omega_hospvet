const repository = require('./doctores.repository');

// Mismo patrón de errores con `.status` que areas.service.js — el
// controller los atrapa para re-renderizar el formulario con el mensaje,
// en vez de un 400 JSON crudo (esto es un fragmento HTMX, no una API).
class DoctorValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['doctor', 'areas', 'estado'];
const TEXTO_MAX_LENGTH = 100;

function parsePage(rawPage) {
  const page = Number.parseInt(rawPage, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSort(rawSort) {
  return SORT_COLUMNS.includes(rawSort) ? rawSort : 'doctor';
}

function parseDir(rawDir) {
  return rawDir === 'desc' ? 'desc' : 'asc';
}

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Query params de un listado GET: se sanean con valores por defecto en vez
// de rechazarse con un error — a diferencia de un formulario que modifica
// estado, un parámetro de página/búsqueda/orden raro no amerita un 400,
// solo cae a la página 1 / sin filtro / orden por defecto.
async function list({ q, estado, page: rawPage, sort: rawSort, dir: rawDir }) {
  const trimmedQ = (q ?? '').trim();
  const activoOnly = estado !== 'todos';
  const page = parsePage(rawPage);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = { q: trimmedQ || undefined, activoOnly };

  const [doctores, total, catalogoVacio] = await Promise.all([
    repository.findPage({ ...filters, sort, dir, limit: PAGE_SIZE, offset }),
    repository.count(filters),
    repository.existsAny().then((exists) => !exists),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    doctores,
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

// US-608: baja lógica (activo=false + desactivado_por/desactivado_en), nunca
// un DELETE físico — el historial de citas/laboratorio sigue referenciando
// este doctor. Un id inválido/inexistente no truena, simplemente no hace
// nada (mismo criterio permisivo que el resto del módulo).
async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.desactivar(id, usuarioId);
}

// US-607: para precargar el formulario de edición — incluye las áreas ya
// asignadas (id + nombre) para pintar la tabla de especialidades.
async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const doctor = await repository.findById(id);
  if (!doctor) return undefined;
  const areas = await repository.findAreasByDoctorId(id);
  return { ...doctor, areas };
}

// Catálogo de áreas activas para el <select> de "Especialidades" del
// formulario (alta y edición usan el mismo).
async function listAreasDisponibles() {
  return repository.listAreasActivas();
}

function validateTexto(rawValor, etiqueta) {
  const valor = (rawValor ?? '').trim();
  if (!valor) {
    throw new DoctorValidationError(`El campo ${etiqueta} es obligatorio.`);
  }
  if (valor.length > TEXTO_MAX_LENGTH) {
    throw new DoctorValidationError(
      `El campo ${etiqueta} no puede tener más de ${TEXTO_MAX_LENGTH} caracteres.`,
    );
  }
  return valor;
}

// El checkbox "Activo" del formulario solo viaja en el body cuando está
// marcado (comportamiento estándar de un <input type="checkbox">) — su
// ausencia significa desmarcado, no un valor inválido que rechazar.
function parseActivo(rawActivo) {
  return rawActivo === 'true';
}

// Normaliza los ids de área seleccionados en el formulario: pueden llegar
// como un solo string (una sola especialidad), un array (dos o más), o
// undefined (ninguna) — el AC permite explícitamente guardar sin áreas.
// Los valores que no sean un entero positivo se descartan en silencio
// (mismo criterio permisivo que parseId) en vez de rechazar todo el
// formulario por un id corrupto.
function parseAreaIds(rawAreaIds) {
  const valores = rawAreaIds === undefined ? [] : [].concat(rawAreaIds);
  const ids = valores
    .map((valor) => Number.parseInt(valor, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

// Resuelve los ids de área submitteados a { id, nombre } — usado por el
// controller para volver a pintar la tabla de especialidades en un
// re-render por error, con exactamente lo que el usuario tenía armado (no
// lo que ya está guardado en la base).
async function resolverAreas(rawAreaIds) {
  const areaIds = parseAreaIds(rawAreaIds);
  if (!areaIds.length) return [];
  return repository.findAreasByIds(areaIds);
}

// US-607 AC: alta — inserta el doctor y sus especialidades (si eligió
// alguna). `nombre`/`apellidos` no son únicos en este catálogo (a
// diferencia de `areas.nombre`), así que no hay chequeo de duplicados.
async function crear({
  nombre: rawNombre,
  apellidos: rawApellidos,
  activo: rawActivo,
  areaIds: rawAreaIds,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre(s)');
  const apellidos = validateTexto(rawApellidos, 'Apellidos');
  const activo = parseActivo(rawActivo);
  const areaIds = parseAreaIds(rawAreaIds);
  return repository.crear({ nombre, apellidos, activo, areaIds, usuarioId });
}

// US-607 AC: edición — actualiza nombre/apellidos/activo y sustituye la
// selección de especialidades por la actual. El permiso de crear vs.
// editar se valida en la ruta (middleware), no aquí — ver doctores.routes.js.
async function editar({
  id,
  nombre: rawNombre,
  apellidos: rawApellidos,
  activo: rawActivo,
  areaIds: rawAreaIds,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre(s)');
  const apellidos = validateTexto(rawApellidos, 'Apellidos');
  const activo = parseActivo(rawActivo);
  const areaIds = parseAreaIds(rawAreaIds);
  await repository.editar({ id, nombre, apellidos, activo, areaIds, usuarioId });
}

module.exports = {
  list,
  desactivar,
  obtener,
  listAreasDisponibles,
  resolverAreas,
  crear,
  editar,
  DoctorValidationError,
};
