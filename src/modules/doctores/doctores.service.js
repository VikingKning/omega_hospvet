const repository = require('./doctores.repository');

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['doctor', 'areas', 'estado'];

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

module.exports = { list, desactivar };
