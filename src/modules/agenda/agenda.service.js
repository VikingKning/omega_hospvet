const repository = require('./agenda.repository');
const areasRepository = require('../areas/areas.repository');
const doctoresRepository = require('../doctores/doctores.repository');

// Mismo patrón de errores con `.status` que areas.service.js — el
// controller los atrapa para re-renderizar el formulario con el mensaje,
// en vez de un 400/409 JSON crudo (fragmento HTMX, no una API).
class CitaValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class TraslapeError extends Error {
  constructor() {
    super('El doctor ya tiene otra cita en ese horario.');
    this.status = 409;
  }
}

class DoctorFueraDeAreaError extends Error {
  constructor() {
    super('El doctor seleccionado no atiende esta área.');
    this.status = 400;
  }
}

// Presets fijos del <select> de duración del formulario — whitelist real,
// no solo una sugerencia visual (mismo criterio que cualquier <select> de
// este sistema: nunca se confía en que el cliente mande uno de estos
// valores solo porque el HTML los ofrece).
const DURACIONES_VALIDAS = [15, 30, 45, 60, 90];

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Agenda: resuelve el área de la URL (/agenda/:slug.html) contra un área
// real y activa — un slug inexistente o de un área desactivada no debe
// abrir un calendario "huérfano".
async function resolverArea(slug) {
  const area = await areasRepository.findBySlug(slug);
  return area && area.activo ? area : undefined;
}

// Catálogo chico para el combobox de "Doctor" — se embebe entero en la
// página (isla JSON), no hace falta una búsqueda incremental como en
// mascotas (ver tutores.service.js#buscarMascotas).
async function listarDoctoresDelArea(areaId) {
  return doctoresRepository.findActivosByAreaId(areaId);
}

async function resumenDelDia(areaId) {
  const ahora = new Date();
  const inicioDia = new Date(ahora);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(ahora);
  finDia.setHours(23, 59, 59, 999);

  const [citasDeHoy, siguiente] = await Promise.all([
    repository.findEnRango(areaId, inicioDia, finDia),
    repository.findSiguiente(areaId, ahora),
  ]);

  // "Pasadas"/"pendientes" se deciden solo por la hora (< o >= ahora) —
  // confirmada o registrada da igual, nunca se cuentan las canceladas
  // (repository.findEnRango ya las excluye por completo).
  const pasadas = citasDeHoy.filter((cita) => new Date(cita.fecha_hora_inicio) < ahora);
  const pendientes = citasDeHoy.filter((cita) => new Date(cita.fecha_hora_inicio) >= ahora);

  return { pasadas, pendientes, siguiente: siguiente ?? null };
}

// Feed del calendario: FullCalendar pide `start`/`end` automáticamente al
// navegar semana/día (opción `events: { url }`). `doctorId` es el filtro
// opcional de doctor (pedido explícito del usuario) — un valor inválido/
// vacío simplemente no filtra, no truena (es un filtro de vista, no un
// dato que se vaya a guardar).
async function listarEventos(areaId, { desde, hasta, doctorId }) {
  return repository.findEnRango(
    areaId,
    new Date(desde),
    new Date(hasta),
    parseId(doctorId) ?? undefined,
  );
}

// Bloques "ocupado" (sin detalle) del doctor filtrado en OTRAS áreas —
// pedido explícito del usuario. Sin doctorId (nadie filtrado todavía) no
// tiene sentido preguntar por nadie: regresa vacío en vez de tronar.
async function listarOcupado(areaId, { desde, hasta, doctorId }) {
  const id = parseId(doctorId);
  if (id === null) return [];
  return repository.findOcupadoPorDoctor(id, new Date(desde), new Date(hasta), areaId);
}

function validateDoctorId(raw) {
  const id = parseId(raw);
  if (id === null) throw new CitaValidationError('Selecciona un doctor.');
  return id;
}

function validateMascotaId(raw) {
  const id = parseId(raw);
  if (id === null) throw new CitaValidationError('Selecciona una mascota (paciente).');
  return id;
}

// El cliente arma este valor combinando los <input type="date">/"time"> en
// hora LOCAL DEL NAVEGADOR y lo convierte a ISO con `Date.toISOString()`
// (ver agenda.ejs) — aquí solo se parsea, nunca se asume ni se hardcodea
// ninguna zona horaria del lado del servidor. Pedido explícito del usuario:
// no se pueden agendar citas del momento actual hacia atrás (ni "hoy más
// temprano") — se comparte esta validación entre crear() y editar(), así
// que también aplica a reagendar una cita existente hacia un horario ya
// pasado.
function validateFechaHoraInicio(raw) {
  const fecha = raw ? new Date(raw) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) {
    throw new CitaValidationError('La fecha y hora de la cita son obligatorias.');
  }
  if (fecha < new Date()) {
    throw new CitaValidationError('No se pueden agendar citas en el pasado.');
  }
  return fecha;
}

function validateDuracion(raw) {
  const duracion = Number.parseInt(raw, 10);
  if (!DURACIONES_VALIDAS.includes(duracion)) {
    throw new CitaValidationError('La duración de la cita no es válida.');
  }
  return duracion;
}

function calcularFin(inicio, duracionMinutos) {
  return new Date(inicio.getTime() + duracionMinutos * 60000);
}

async function validarDoctorEnArea(doctorId, areaId) {
  const doctores = await doctoresRepository.findActivosByAreaId(areaId);
  if (!doctores.some((doctor) => doctor.id === doctorId)) {
    throw new DoctorFueraDeAreaError();
  }
}

async function validarTraslape(doctorId, inicio, fin, excludeId) {
  const traslape = await repository.existeTraslape(doctorId, inicio, fin, excludeId);
  if (traslape) {
    throw new TraslapeError();
  }
}

// US: alta desde el portal — nace `confirmada` directamente (decisión
// explícita del usuario, ver plan). Rechaza si el doctor no atiende esta
// área o si traslapa con otra cita del mismo doctor.
async function crear({
  areaId,
  doctorId: rawDoctorId,
  mascotaId: rawMascotaId,
  fechaHoraInicio: rawFecha,
  duracionMinutos: rawDuracion,
  motivo: rawMotivo,
  usuarioId,
}) {
  const doctorId = validateDoctorId(rawDoctorId);
  const mascotaId = validateMascotaId(rawMascotaId);
  const fechaHoraInicio = validateFechaHoraInicio(rawFecha);
  const duracionMinutos = validateDuracion(rawDuracion);
  const fin = calcularFin(fechaHoraInicio, duracionMinutos);
  const motivo = (rawMotivo ?? '').trim() || null;

  await validarDoctorEnArea(doctorId, areaId);
  await validarTraslape(doctorId, fechaHoraInicio, fin);

  return repository.create({
    areaId,
    doctorId,
    mascotaId,
    fechaHoraInicio,
    duracionMinutos,
    motivo,
    usuarioId,
  });
}

// Editar: puede reagendar (fecha/hora/doctor), cambiar de mascota o motivo
// — nunca toca `estado` (decisión explícita del usuario: "editar" y
// "confirmar" son acciones separadas, y esta iteración no expone
// "confirmar" porque nada nace `registrada` desde el portal).
async function editar({
  id,
  areaId,
  doctorId: rawDoctorId,
  mascotaId: rawMascotaId,
  fechaHoraInicio: rawFecha,
  duracionMinutos: rawDuracion,
  motivo: rawMotivo,
  usuarioId,
}) {
  const doctorId = validateDoctorId(rawDoctorId);
  const mascotaId = validateMascotaId(rawMascotaId);
  const fechaHoraInicio = validateFechaHoraInicio(rawFecha);
  const duracionMinutos = validateDuracion(rawDuracion);
  const fin = calcularFin(fechaHoraInicio, duracionMinutos);
  const motivo = (rawMotivo ?? '').trim() || null;

  await validarDoctorEnArea(doctorId, areaId);
  await validarTraslape(doctorId, fechaHoraInicio, fin, id);

  await repository.update(id, {
    doctorId,
    mascotaId,
    fechaHoraInicio,
    duracionMinutos,
    motivo,
    usuarioId,
  });
}

// "Eliminar" en la UI es cancelar — baja lógica (mismo patrón que todo el
// resto del sistema). Un id inválido/inexistente no truena.
async function cancelar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.cancelar(id, usuarioId);
}

// Para precargar el formulario de edición.
async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  return repository.findById(id);
}

module.exports = {
  resolverArea,
  listarDoctoresDelArea,
  resumenDelDia,
  listarEventos,
  listarOcupado,
  crear,
  editar,
  cancelar,
  obtener,
  CitaValidationError,
  TraslapeError,
  DoctorFueraDeAreaError,
};
