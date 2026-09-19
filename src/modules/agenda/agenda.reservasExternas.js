const logger = require('../../config/logger');
const repository = require('./agenda.repository');
const areasRepository = require('../areas/areas.repository');
const tutoresRepository = require('../tutores/tutores.repository');

const AREA_SLUG_CONSULTAS = 'consultas';

const SENAL_TITULO = 'Consultas Veterinarias';

const SENAL_DESCRIPCION =
  'Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla.';

const REGEX_TELEFONO_CANDIDATO = /\b(\d[\d\s-]{7,13}\d)\b/;
const REGEX_MASCOTA = /Nombre de la Mascota\s*\n+([^\n]+)/i;
const REGEX_TUTOR = /Programada por\s*\n+([^\n]+)/;
const REGEX_CORREO = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const REGEX_MOTIVO_CONSULTA = /Motivo de Consulta:?\s*\n+([^\n]+)/i;

const DIACRITIC_MARKS = /[̀-ͯ]/g;
function normalizeNombre(nombre) {
  return nombre.normalize('NFD').replace(DIACRITIC_MARKS, '').toLowerCase().replace(/\s+/g, '');
}

function esReservaDeConsultas(summary, description) {
  const tituloCoincide =
    typeof summary === 'string' && summary.toLowerCase().includes(SENAL_TITULO.toLowerCase());
  if (!tituloCoincide) return false;
  return typeof description === 'string' && description.includes(SENAL_DESCRIPCION);
}

function quitarHtml(texto) {
  return texto.replace(/<[^>]+>/g, '');
}

function extraerTelefono(texto) {
  const candidato = texto.match(REGEX_TELEFONO_CANDIDATO)?.[1];
  if (!candidato) return null;
  const digitos = candidato.replace(/[\s-]/g, '');
  return digitos.length === 10 ? digitos : null;
}

function extraerDatosReserva(summary, description) {
  if (!esReservaDeConsultas(summary, description)) return null;

  const texto = quitarHtml(description);
  return {
    telefono: extraerTelefono(texto),
    nombreMascota: texto.match(REGEX_MASCOTA)?.[1]?.trim() || null,
    nombreTutor: texto.match(REGEX_TUTOR)?.[1]?.trim() || null,
    correo: texto.match(REGEX_CORREO)?.[0] ?? null,
    motivoConsulta: texto.match(REGEX_MOTIVO_CONSULTA)?.[1]?.trim() || null,
  };
}

async function resolverReserva({ telefono, nombreMascota }) {
  if (!telefono) {
    return { propietarioId: null, mascotaId: null, estado: 'registrada' };
  }

  const propietario = await tutoresRepository.findByTelefono(telefono);
  if (!propietario) {
    return { propietarioId: null, mascotaId: null, estado: 'registrada' };
  }

  if (!nombreMascota) {
    return { propietarioId: propietario.id, mascotaId: null, estado: 'registrada' };
  }

  const mascotas = await tutoresRepository.findMascotasByPropietarioId(propietario.id);
  const objetivo = normalizeNombre(nombreMascota);
  const mascota = mascotas.find((m) => normalizeNombre(m.nombre) === objetivo);

  if (!mascota) {
    return { propietarioId: propietario.id, mascotaId: null, estado: 'registrada' };
  }

  return { propietarioId: propietario.id, mascotaId: mascota.id, estado: 'confirmada' };
}

function construirMotivo(
  { nombreTutor, telefono, correo, nombreMascota, motivoConsulta },
  resuelto,
) {
  const partes = [];
  if (motivoConsulta) {
    partes.push(`Motivo de consulta (indicado por el cliente): ${motivoConsulta}.`);
  }
  if (resuelto.mascotaId) {
    partes.push('Reserva externa (Google Calendar), datos completados automáticamente.');
  } else if (resuelto.propietarioId) {
    partes.push(
      'Reserva externa (Google Calendar) — tutor identificado, falta asignar la mascota.',
    );
  } else {
    partes.push(
      'Reserva externa (Google Calendar) — sin match, el staff debe completar tutor y mascota.',
    );
  }
  partes.push(`Nombre en la reserva: ${nombreTutor ?? '(no indicado)'}.`);
  partes.push(`Teléfono: ${telefono ?? '(no indicado)'}.`);
  if (correo) partes.push(`Correo: ${correo}.`);
  partes.push(`Mascota indicada: ${nombreMascota ?? '(no indicado)'}.`);
  return partes.join(' ');
}

async function importarReserva(evento) {
  try {
    const datos = extraerDatosReserva(evento.summary, evento.description);
    if (!datos) return null;

    const yaExiste = await repository.findByGoogleEventId(evento.id);
    if (yaExiste) return null;

    const inicio = evento.start?.dateTime ? new Date(evento.start.dateTime) : null;
    const fin = evento.end?.dateTime ? new Date(evento.end.dateTime) : null;
    if (!inicio || !fin) return null;

    const [area, doctor, resuelto] = await Promise.all([
      areasRepository.findBySlug(AREA_SLUG_CONSULTAS),
      repository.obtenerOCrearDoctorConsultasPredeterminado(),
      resolverReserva(datos),
    ]);

    if (!area || !doctor) {
      logger.error(
        { eventoId: evento.id },
        'No se pudo importar la reserva: falta el área "consultas" (verifica que exista y esté activa) o no se pudo crear/obtener el doctor predeterminado.',
      );
      return null;
    }

    const duracionMinutos = Math.round((fin.getTime() - inicio.getTime()) / 60000);

    return await repository.crearDesdeReservaExterna({
      areaId: area.id,
      doctorId: doctor.id,
      mascotaId: resuelto.mascotaId,
      propietarioId: resuelto.propietarioId,
      fechaHoraInicio: inicio,
      duracionMinutos,
      motivo: construirMotivo(datos, resuelto),
      estado: resuelto.estado,
      googleEventId: evento.id,
    });
  } catch (err) {
    logger.error(
      { err, eventoId: evento.id },
      'No se pudo importar una reserva externa de Consultas.',
    );
    return null;
  }
}

module.exports = { esReservaDeConsultas, extraerDatosReserva, resolverReserva, importarReserva };
