const repository = require('./usuarios.repository');

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['nombre', 'username', 'correo', 'estatus'];
const ESTATUS_VALUES = ['activo', 'bloqueo_temp', 'bloqueado', 'inactivo'];

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

// Filtro de Estatus: a diferencia del switch Activos/Todos de
// doctores/áreas (booleano), aquí hay 5 opciones reales (Todos + los 4
// valores de usuarios.estatus del bloqueo escalonado de US-106). Por
// defecto es "activo" (decidido explícitamente con el usuario — a
// diferencia de plantillas, que por AC explícito default a "todos"; aquí
// el AC no lo especificaba, así que se preguntó y "activo" quedó como el
// criterio consistente con doctores/áreas). Cualquier valor que no sea uno
// de los 4 estatus válidos ni "todos" cae al default, nunca truena.
function parseEstatus(rawEstatus) {
  if (ESTATUS_VALUES.includes(rawEstatus)) return rawEstatus;
  if (rawEstatus === 'todos') return 'todos';
  return 'activo';
}

// Query params de un listado GET: se sanean con valores por defecto en vez
// de rechazarse con un error (mismo criterio que el resto de los catálogos
// de Configuraciones).
async function list({ q, estatus: rawEstatus, page: rawPage, sort: rawSort, dir: rawDir }) {
  const trimmedQ = (q ?? '').trim();
  const estatus = parseEstatus(rawEstatus);
  const filtroEstatus = estatus === 'todos' ? undefined : estatus;
  const page = parsePage(rawPage);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = { q: trimmedQ || undefined, estatus: filtroEstatus };

  const [usuarios, total, catalogoVacio] = await Promise.all([
    repository.findPage({ ...filters, sort, dir, limit: PAGE_SIZE, offset }),
    repository.count(filters),
    repository.existsAny().then((exists) => !exists),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    usuarios,
    total,
    catalogoVacio,
    page: Math.min(page, totalPages),
    totalPages,
    pageSize: PAGE_SIZE,
    q: trimmedQ,
    estatus,
    sort,
    dir,
  };
}

module.exports = { list };
