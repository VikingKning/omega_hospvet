const repository = require('./tutores.repository');

// Mismo patrón de errores con `.status` que auth.service.js/areas.service.js
// — el controller los atrapa para responder JSON con el mensaje, sin
// tronar con un 500.
class TutorValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// US-156 AC5, decidido con el usuario: el teléfono capturado ya pertenece a
// OTRO propietario, pero INACTIVO — no es un error final, es una PREGUNTA
// ("¿reactivar este registro?") que el cliente debe responder antes de
// continuar (ver tutor-form.ejs, modal de confirmación). No extiende
// TutorValidationError a propósito: el controller la atrapa aparte, con su
// propia forma de respuesta (`requiereConfirmacion`, no `error`).
class RequiereConfirmacionReactivacionError extends Error {
  constructor(tutorExistente) {
    super('El teléfono ya pertenece a un propietario inactivo.');
    this.tutorExistente = tutorExistente;
  }
}

const PAGE_SIZE = 10;
const NOMBRE_TUTOR_MAX = 150;
const NOMBRE_PACIENTE_MAX = 100;
const TIPO_PACIENTE_MAX = 20;
const RAZA_PACIENTE_MAX = 100;
const FORMATO_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mismo formato ya establecido en el resto del sistema para teléfono
// mexicano (10 dígitos, NN-NNNN-NNNN) — perfil.service.js#TELEFONO_REGEX es
// la referencia (ahí es opcional; aquí es obligatorio, AC3/AC4, pero el
// FORMATO en sí debe ser el mismo en todos los formularios del sistema,
// pedido explícito del usuario). usuarios.service.js no lo valida del lado
// del servidor todavía (solo el cliente, vía el atributo `pattern` del
// input) — inconsistencia previa del proyecto, no un segundo estándar a
// seguir.
const TELEFONO_REGEX = /^\d{2}-\d{4}-\d{4}$/;

// Ajuste posterior, pedido explícito del usuario: el formato NN-NNNN-NNNN
// es solo "look and feel" — lo que se guarda en `propietarios.telefono` son
// los 10 dígitos, sin guiones (ver migración
// 20260819000001_normalizar_telefonos_sin_guiones.js para los datos que ya
// existían). `stripTelefono` se usa antes de guardar/comparar;
// `formatTelefono` reconstruye el formato solo al devolver un teléfono para
// MOSTRARLO (listado, formulario precargado, resultados del buscador) —
// nunca se guarda el resultado de formatTelefono.
function stripTelefono(telefono) {
  return (telefono ?? '').replace(/\D/g, '');
}

function formatTelefono(telefono) {
  const digits = stripTelefono(telefono);
  if (digits.length !== 10) return telefono;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
}

function parsePage(rawPage) {
  const page = Number.parseInt(rawPage, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateTexto(rawValor, etiqueta, maxLength) {
  const valor = (rawValor ?? '').trim();
  if (!valor) {
    throw new TutorValidationError(`El campo ${etiqueta} es obligatorio.`);
  }
  if (valor.length > maxLength) {
    throw new TutorValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

// Tipo/Raza del paciente son opcionales a nivel de esquema (mascotas.tipo/
// raza son NULLABLE, a diferencia de mascotas.nombre) — se valida longitud
// si viene algo, pero nunca se exige que venga.
function validateTextoOpcional(rawValor, etiqueta, maxLength) {
  const valor = (rawValor ?? '').trim();
  if (!valor) return '';
  if (valor.length > maxLength) {
    throw new TutorValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

// AC3/AC4: obligatorio (a diferencia de perfil.telefono, que es opcional) —
// se rechaza vacío con el mismo mensaje genérico de "obligatorio" que el
// resto de campos requeridos, y con formato con el mismo mensaje exacto
// que perfil.service.js#validateTelefono.
function validateTelefono(rawTelefono) {
  const telefono = (rawTelefono ?? '').trim();
  if (!telefono) {
    throw new TutorValidationError('El campo Teléfono es obligatorio.');
  }
  if (!TELEFONO_REGEX.test(telefono)) {
    throw new TutorValidationError('El teléfono debe tener el formato NN-NNNN-NNNN.');
  }
  return stripTelefono(telefono);
}

function validateCorreo(rawCorreo) {
  const correo = (rawCorreo ?? '').trim();
  if (!correo) return null;
  if (!FORMATO_CORREO.test(correo)) {
    throw new TutorValidationError('El correo no tiene un formato válido.');
  }
  return correo;
}

// AC11/AC13: cada paciente capturado necesita como mínimo Nombre (Tipo/Raza
// opcionales, ver validateTextoOpcional). Un paciente YA existente (trae
// `id`) respeta el `activo` que mande el cliente (AC17/19: baja/reactivar);
// uno nuevo siempre nace activo (AC13), sin importar lo que venga en el
// body — nunca se puede dar de alta un paciente ya inactivo de origen.
function parsePacientes(rawPacientes) {
  const valores = Array.isArray(rawPacientes) ? rawPacientes : [];
  return valores.map((paciente, index) => {
    const nombre = validateTexto(
      paciente?.nombre,
      `Nombre del paciente ${index + 1}`,
      NOMBRE_PACIENTE_MAX,
    );
    const tipo = validateTextoOpcional(
      paciente?.tipo,
      `Tipo del paciente ${index + 1}`,
      TIPO_PACIENTE_MAX,
    );
    const raza = validateTextoOpcional(
      paciente?.raza,
      `Raza del paciente ${index + 1}`,
      RAZA_PACIENTE_MAX,
    );
    const id = parseId(paciente?.id);
    const activo = id === null ? true : paciente?.activo !== false;
    return { id, nombre, tipo, raza, activo };
  });
}

// Ambos filtros de estado (Tutores/Pacientes) son independientes entre sí
// (AC: "se aplican de forma conjunta e independiente") — cada uno solo
// tiene 2 valores válidos, cualquier otra cosa cae a "activos" por default
// (mismo criterio permisivo que el resto de los módulos: un valor raro no
// amerita un 400, solo el default seguro).
function normalizeEstado(rawEstado) {
  return rawEstado === 'todos' ? 'todos' : 'activos';
}

function includes(valor, qLower) {
  return (valor ?? '').toLowerCase().includes(qLower);
}

// Ajuste posterior, pedido explícito del usuario: buscar "5520108565"
// (sin guiones) debe encontrar un teléfono guardado como "5520108565"
// (ahora siempre sin guiones, ver stripTelefono/formatTelefono arriba) aun
// si lo que el usuario escribió en la caja de búsqueda SÍ traía guiones
// ("55-2010-8565") — se compara `qDigits` (los dígitos de la búsqueda,
// puede venir vacío si `q` no tiene ningún dígito) contra el teléfono tal
// cual está guardado, en vez de comparar el `q` crudo.
//
// AC: la búsqueda coincide con nombre/teléfono/correo del tutor.
function tutorCoincide(tutor, qLower, qDigits) {
  return (
    includes(tutor.nombre, qLower) ||
    (qDigits && (tutor.telefono ?? '').includes(qDigits)) ||
    includes(tutor.correo, qLower)
  );
}

// AC: la búsqueda coincide con nombre/tipo/raza del paciente.
function mascotaCoincide(mascota, qLower) {
  return (
    includes(mascota.nombre, qLower) ||
    includes(mascota.tipo, qLower) ||
    includes(mascota.raza, qLower)
  );
}

// Query params de un listado GET: se sanean con valores por defecto en vez
// de rechazarse con un error, mismo criterio que doctores/areas.service.js.
async function list({
  q: rawQ,
  estadoTutores: rawEstadoTutores,
  estadoPacientes: rawEstadoPacientes,
  page: rawPage,
}) {
  const q = (rawQ ?? '').trim();
  const qDigits = stripTelefono(q);
  const estadoTutores = normalizeEstado(rawEstadoTutores);
  const estadoPacientes = normalizeEstado(rawEstadoPacientes);
  const activoTutores = estadoTutores === 'activos';
  const activoPacientes = estadoPacientes === 'activos';
  const page = parsePage(rawPage);

  const filtrosTutores = {
    q: q || undefined,
    qDigits: qDigits || undefined,
    activoTutores,
    activoPacientes,
  };

  const [total, catalogoVacio] = await Promise.all([
    repository.count(filtrosTutores),
    repository.existsAny().then((exists) => !exists),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const offset = (clampedPage - 1) * PAGE_SIZE;

  const tutoresRows = await repository.findPage({ ...filtrosTutores, limit: PAGE_SIZE, offset });
  const tutorIds = tutoresRows.map((tutor) => tutor.id);
  const mascotasRows = tutorIds.length
    ? await repository.mascotasPorPropietarios(tutorIds, { activoPacientes })
    : [];

  const mascotasPorTutor = new Map();
  for (const mascota of mascotasRows) {
    if (!mascotasPorTutor.has(mascota.propietario_id))
      mascotasPorTutor.set(mascota.propietario_id, []);
    mascotasPorTutor.get(mascota.propietario_id).push(mascota);
  }

  // AC: si el tutor coincidió por sus PROPIOS campos (o no hay búsqueda),
  // se muestran todos sus pacientes que pasen el filtro de estado; si
  // coincidió solo porque uno de sus pacientes hizo match, se muestran
  // únicamente los pacientes que también cumplan la búsqueda (además del
  // filtro de estado, ya aplicado arriba al traer mascotasRows).
  const qLower = q.toLowerCase();
  const tutores = tutoresRows.map((tutor) => {
    let pacientes = mascotasPorTutor.get(tutor.id) ?? [];
    if (q && !tutorCoincide(tutor, qLower, qDigits)) {
      pacientes = pacientes.filter((mascota) => mascotaCoincide(mascota, qLower));
    }
    return { ...tutor, telefono: formatTelefono(tutor.telefono), pacientes };
  });

  return {
    tutores,
    total,
    catalogoVacio,
    page: clampedPage,
    totalPages,
    pageSize: PAGE_SIZE,
    q,
    estadoTutores,
    estadoPacientes,
  };
}

// US-156: para precargar el formulario de edición (AC2/AC14) — trae el
// propietario junto con TODAS sus mascotas (activas e inactivas, a
// diferencia de list()), porque el formulario necesita poder mostrar y
// reactivar una mascota inactiva.
async function obtenerParaEditar(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const propietario = await repository.findById(id);
  if (!propietario) return undefined;
  const pacientes = await repository.findMascotasByPropietarioId(id);
  return { ...propietario, telefono: formatTelefono(propietario.telefono), pacientes };
}

// US-156 AC7/AC8/AC9/AC10/AC12/AC13: alta. Si el teléfono ya pertenece a un
// propietario ACTIVO, se rechaza (AC5). Si pertenece a uno INACTIVO, no se
// inserta un registro nuevo (violaría el UNIQUE de propietarios.telefono):
// se pide confirmación explícita al cliente (decidido con el usuario) y,
// solo si ya confirmó (`confirmarReactivacion`), se reactiva ESE registro
// con los datos de este formulario en vez de crear uno nuevo.
async function crear({
  nombre: rawNombre,
  telefono: rawTelefono,
  correo: rawCorreo,
  pacientes: rawPacientes,
  confirmarReactivacion,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre', NOMBRE_TUTOR_MAX);
  const telefono = validateTelefono(rawTelefono);
  const correo = validateCorreo(rawCorreo);
  const pacientes = parsePacientes(rawPacientes);

  const existente = await repository.findByTelefono(telefono);
  if (existente) {
    if (existente.activo) {
      throw new TutorValidationError('El teléfono ya se encuentra registrado.');
    }
    if (!confirmarReactivacion) {
      throw new RequiereConfirmacionReactivacionError({
        nombre: existente.nombre,
        telefono: formatTelefono(existente.telefono),
      });
    }
    return repository.reactivar({
      id: existente.id,
      nombre,
      telefono,
      correo,
      pacientes,
      usuarioId,
    });
  }

  return repository.crear({ nombre, telefono, correo, pacientes, usuarioId });
}

// US-156 AC15/16/17/19/21: edición. A diferencia de crear(), aquí NUNCA se
// reactiva — si el teléfono ya pertenece a CUALQUIER otro propietario
// (activo o inactivo), se rechaza igual (mismo criterio que
// areas.service.js#editar: "no hay reactivar al editar, sería fusionar la
// identidad de dos registros distintos", algo que ningún AC de esta
// historia pidió).
async function editar({
  id: rawId,
  nombre: rawNombre,
  telefono: rawTelefono,
  correo: rawCorreo,
  pacientes: rawPacientes,
  usuarioId,
}) {
  const id = parseId(rawId);
  const nombre = validateTexto(rawNombre, 'Nombre', NOMBRE_TUTOR_MAX);
  const telefono = validateTelefono(rawTelefono);
  const correo = validateCorreo(rawCorreo);
  const pacientes = parsePacientes(rawPacientes);

  const existente = await repository.findByTelefono(telefono, id);
  if (existente) {
    throw new TutorValidationError('El teléfono ya se encuentra registrado.');
  }

  await repository.editar({ id, nombre, telefono, correo, pacientes, usuarioId });
  return id;
}

const BUSQUEDA_TELEFONO_LIMIT = 8;

// US-156 (pedido del usuario, ajustado después): búsqueda incremental
// mientras se captura el teléfono en el alta — sin texto, sugiere los
// primeros propietarios (activos); con texto, filtra por coincidencia
// parcial. Sin mínimo de caracteres a propósito: el AC pide explícitamente
// que "si no tiene nada, salen todos los usuarios" (activos, limitados a
// BUSQUEDA_TELEFONO_LIMIT).
async function buscarPorTelefono(rawQ) {
  // El combobox manda lo que el usuario ya escribió CON la máscara (guiones
  // incluidos) — se quitan aquí porque lo guardado en BD ya no los tiene.
  const q = stripTelefono(rawQ);
  const resultados = await repository.searchByTelefono(q, BUSQUEDA_TELEFONO_LIMIT);
  return resultados.map((r) => ({ ...r, telefono: formatTelefono(r.telefono) }));
}

// US-157 (ajuste posterior, pedido del usuario): chequeo EXACTO del
// teléfono al salir del campo (blur) en el alta — a diferencia de
// buscarPorTelefono() (parcial, incremental, solo activos, para navegar
// mientras se escribe), este SÍ revela un propietario INACTIVO: es
// justo el punto de entrada de la reactivación, ahora disparado al salir
// del campo en vez de hasta el guardado (crear(), arriba, sigue siendo el
// respaldo real vía confirmarReactivacion si el cliente nunca pasó por
// aquí). Si es inactivo, trae también correo y mascotas completas para
// precargar el formulario ("mostrar toda su información y mascotas",
// pedido del usuario) en vez de dejar que el usuario adivine.
async function verificarTelefono(rawTelefono) {
  const telefono = stripTelefono(rawTelefono);
  const existente = await repository.findByTelefono(telefono);
  if (!existente) return { existe: false };
  if (existente.activo) {
    return { existe: true, activo: true, tutor: { id: existente.id, nombre: existente.nombre } };
  }
  const pacientes = await repository.findMascotasByPropietarioId(existente.id);
  return {
    existe: true,
    activo: false,
    tutor: {
      id: existente.id,
      nombre: existente.nombre,
      telefono: formatTelefono(existente.telefono),
      correo: existente.correo,
      pacientes,
    },
  };
}

// US-157: baja lógica (activo=false + desactivado_por/desactivado_en),
// nunca un DELETE físico — mismo criterio permisivo que el resto de los
// módulos: un id inválido/inexistente no truena, simplemente no hace nada.
async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.desactivar(id, usuarioId);
}

module.exports = {
  list,
  obtenerParaEditar,
  crear,
  editar,
  buscarPorTelefono,
  verificarTelefono,
  desactivar,
  TutorValidationError,
  RequiereConfirmacionReactivacionError,
};
