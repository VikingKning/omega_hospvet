const repository = require('./doctores.repository');

class DoctorValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class DoctorPredeterminadoError extends Error {
  constructor() {
    super('Este es un doctor predeterminado del sistema y no se puede editar ni dar de baja.');
    this.status = 400;
  }
}

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['doctor', 'areas', 'estado'];
const TEXTO_MAX_LENGTH = 100;
const CEDULA_PROFESIONAL_REGEX = /^\d{7,10}$/;

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

async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  const doctor = await repository.findById(id);
  if (!doctor) return;
  if (doctor.es_predeterminado) {
    throw new DoctorPredeterminadoError();
  }
  await repository.desactivar(id, usuarioId);
}

async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const doctor = await repository.findById(id);
  if (!doctor) return undefined;
  const areas = await repository.findAreasByDoctorId(id);
  return { ...doctor, areas };
}

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

function validateCedulaProfesional(rawValor) {
  const valor = (rawValor ?? '').toString().trim();
  if (!valor) return null;
  if (!CEDULA_PROFESIONAL_REGEX.test(valor)) {
    throw new DoctorValidationError(
      'La cédula profesional debe contener únicamente entre 7 y 10 números.',
    );
  }
  return valor;
}

function parseActivo(rawActivo) {
  return rawActivo === 'true';
}

function parseAreaIds(rawAreaIds) {
  const valores = rawAreaIds === undefined ? [] : [].concat(rawAreaIds);
  const ids = valores
    .map((valor) => Number.parseInt(valor, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

async function resolverAreas(rawAreaIds) {
  const areaIds = parseAreaIds(rawAreaIds);
  if (!areaIds.length) return [];
  return repository.findAreasByIds(areaIds);
}

async function crear({
  nombre: rawNombre,
  apellidos: rawApellidos,
  cedulaProfesional: rawCedulaProfesional,
  activo: rawActivo,
  areaIds: rawAreaIds,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre(s)');
  const apellidos = validateTexto(rawApellidos, 'Apellidos');
  const cedulaProfesional = validateCedulaProfesional(rawCedulaProfesional);
  const activo = parseActivo(rawActivo);
  const areaIds = parseAreaIds(rawAreaIds);
  return repository.crear({ nombre, apellidos, cedulaProfesional, activo, areaIds, usuarioId });
}

async function editar({
  id,
  nombre: rawNombre,
  apellidos: rawApellidos,
  cedulaProfesional: rawCedulaProfesional,
  activo: rawActivo,
  areaIds: rawAreaIds,
  usuarioId,
}) {
  const parsedId = parseId(id);
  if (parsedId !== null) {
    const actual = await repository.findById(parsedId);
    if (actual?.es_predeterminado) {
      throw new DoctorPredeterminadoError();
    }
  }

  const nombre = validateTexto(rawNombre, 'Nombre(s)');
  const apellidos = validateTexto(rawApellidos, 'Apellidos');
  const cedulaProfesional = validateCedulaProfesional(rawCedulaProfesional);
  const activo = parseActivo(rawActivo);
  const areaIds = parseAreaIds(rawAreaIds);
  await repository.editar({
    id,
    nombre,
    apellidos,
    cedulaProfesional,
    activo,
    areaIds,
    usuarioId,
  });
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
  DoctorPredeterminadoError,
};
