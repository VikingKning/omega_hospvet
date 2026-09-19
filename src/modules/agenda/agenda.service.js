const repository = require('./agenda.repository');
const areasRepository = require('../areas/areas.repository');
const doctoresRepository = require('../doctores/doctores.repository');
const googleSync = require('./agenda.googleSync');
const logger = require('../../config/logger');

function dispararSyncGoogle(citaId) {
  googleSync.pushCita(citaId).catch((err) => {
    logger.error({ err, citaId }, 'Push a Google Calendar no manejado.');
  });
}

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

class CitaNoConfirmableError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const DURACIONES_VALIDAS = [15, 30, 45, 60, 90];

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function resolverArea(slug) {
  const area = await areasRepository.findBySlug(slug);
  return area && area.activo ? area : undefined;
}

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

  const pasadas = citasDeHoy.filter((cita) => new Date(cita.fecha_hora_inicio) < ahora);
  const pendientes = citasDeHoy.filter((cita) => new Date(cita.fecha_hora_inicio) >= ahora);

  return { pasadas, pendientes, siguiente: siguiente ?? null };
}

async function listarEventos(areaId, { desde, hasta, doctorId }) {
  return repository.findEnRango(
    areaId,
    new Date(desde),
    new Date(hasta),
    parseId(doctorId) ?? undefined,
  );
}

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

  const id = await repository.create({
    areaId,
    doctorId,
    mascotaId,
    fechaHoraInicio,
    duracionMinutos,
    motivo,
    usuarioId,
  });
  dispararSyncGoogle(id);
  return id;
}

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
  dispararSyncGoogle(id);
}

async function cancelar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.cancelar(id, usuarioId);
  dispararSyncGoogle(id);
}

async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  return repository.findById(id);
}

async function confirmar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;

  const cita = await repository.findById(id);
  if (!cita) return;

  if (cita.estado !== 'registrada') {
    throw new CitaNoConfirmableError('Esta cita no está pendiente de confirmar.');
  }
  if (cita.mascota_id === null) {
    throw new CitaNoConfirmableError('Completa la mascota antes de confirmar la cita.');
  }

  await repository.confirmar(id, usuarioId);
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
  confirmar,
  CitaValidationError,
  TraslapeError,
  DoctorFueraDeAreaError,
  CitaNoConfirmableError,
};
