const logger = require('../../config/logger');
const repository = require('./agenda.repository');
const areasRepository = require('../areas/areas.repository');
const tutoresRepository = require('../tutores/tutores.repository');

const AREA_SLUG_CONSULTAS = 'consultas';
const AREA_SLUG_ESTETICA = 'estetica';

const SENAL_TITULO_CONSULTAS = 'Consultas Veterinarias';
const SENAL_DESCRIPCION_CONSULTAS =
  'Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla.';

// Página de reservas de Estética/Grooming — mismo formulario de Google que
// Consultas, otro título/descripción propios y otros campos opcionales
// (Peso/Raza en vez de Motivo de Consulta). Bug real reportado 2026-09-22:
// estas reservas nunca se importaban porque no existía ninguna señal para
// reconocerlas.
const SENAL_TITULO_ESTETICA = 'Citas Estetica Omega';
const SENAL_DESCRIPCION_ESTETICA =
  'Agenda aquí la cita de estética de tu compañero de cuatro patas de forma rápida y sencilla.';

const REGEX_TELEFONO_CANDIDATO = /\b(\d[\d\s-]{7,13}\d)\b/;
const REGEX_MASCOTA = /Nombre de la Mascota\s*\n+([^\n]+)/i;
const REGEX_TUTOR = /Programada por\s*\n+([^\n]+)/;
const REGEX_CORREO = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const REGEX_MOTIVO_CONSULTA = /Motivo de Consulta:?\s*\n+([^\n]+)/i;
const REGEX_PESO = /Peso \(kg\)\s*\n+([^\n]+)/i;
const REGEX_RAZA = /Raza\s*\n+([^\n]+)/i;

const DIACRITIC_MARKS = /[̀-ͯ]/g;
function normalizeNombre(nombre) {
  return nombre.normalize('NFD').replace(DIACRITIC_MARKS, '').toLowerCase().replace(/\s+/g, '');
}

function coincideSenal(summary, description, senalTitulo, senalDescripcion) {
  const tituloCoincide =
    typeof summary === 'string' && summary.toLowerCase().includes(senalTitulo.toLowerCase());
  if (!tituloCoincide) return false;
  return typeof description === 'string' && description.includes(senalDescripcion);
}

function esReservaDeConsultas(summary, description) {
  return coincideSenal(summary, description, SENAL_TITULO_CONSULTAS, SENAL_DESCRIPCION_CONSULTAS);
}

function esReservaDeEstetica(summary, description) {
  return coincideSenal(summary, description, SENAL_TITULO_ESTETICA, SENAL_DESCRIPCION_ESTETICA);
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

function extraerDatosReservaEstetica(summary, description) {
  if (!esReservaDeEstetica(summary, description)) return null;

  const texto = quitarHtml(description);
  return {
    telefono: extraerTelefono(texto),
    nombreMascota: texto.match(REGEX_MASCOTA)?.[1]?.trim() || null,
    nombreTutor: texto.match(REGEX_TUTOR)?.[1]?.trim() || null,
    correo: texto.match(REGEX_CORREO)?.[0] ?? null,
    peso: texto.match(REGEX_PESO)?.[1]?.trim() || null,
    raza: texto.match(REGEX_RAZA)?.[1]?.trim() || null,
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

function construirEncabezadoMotivo(resuelto, etiquetaOrigen) {
  if (resuelto.mascotaId) {
    return `Reserva externa de ${etiquetaOrigen} (Google Calendar), datos completados automáticamente.`;
  }
  if (resuelto.propietarioId) {
    return `Reserva externa de ${etiquetaOrigen} (Google Calendar) — tutor identificado, falta asignar la mascota.`;
  }
  return `Reserva externa de ${etiquetaOrigen} (Google Calendar) — sin match, el staff debe completar tutor y mascota.`;
}

function construirMotivo(
  { nombreTutor, telefono, correo, nombreMascota, motivoConsulta },
  resuelto,
) {
  const partes = [];
  if (motivoConsulta) {
    partes.push(`Motivo de consulta (indicado por el cliente): ${motivoConsulta}.`);
  }
  partes.push(construirEncabezadoMotivo(resuelto, 'consulta'));
  partes.push(`Nombre en la reserva: ${nombreTutor ?? '(no indicado)'}.`);
  partes.push(`Teléfono: ${telefono ?? '(no indicado)'}.`);
  if (correo) partes.push(`Correo: ${correo}.`);
  partes.push(`Mascota indicada: ${nombreMascota ?? '(no indicado)'}.`);
  return partes.join(' ');
}

function construirMotivoEstetica(
  { nombreTutor, telefono, correo, nombreMascota, peso, raza },
  resuelto,
) {
  const partes = [];
  if (raza) partes.push(`Raza indicada: ${raza}.`);
  if (peso) partes.push(`Peso indicado: ${peso} kg.`);
  partes.push(construirEncabezadoMotivo(resuelto, 'estética'));
  partes.push(`Nombre en la reserva: ${nombreTutor ?? '(no indicado)'}.`);
  partes.push(`Teléfono: ${telefono ?? '(no indicado)'}.`);
  if (correo) partes.push(`Correo: ${correo}.`);
  partes.push(`Mascota indicada: ${nombreMascota ?? '(no indicado)'}.`);
  return partes.join(' ');
}

async function importarReserva(evento) {
  try {
    const datosConsultas = extraerDatosReserva(evento.summary, evento.description);
    const datosEstetica = datosConsultas
      ? null
      : extraerDatosReservaEstetica(evento.summary, evento.description);
    const datos = datosConsultas ?? datosEstetica;
    if (!datos) return null;

    const yaExiste = await repository.findByGoogleEventId(evento.id);
    if (yaExiste) return null;

    const inicio = evento.start?.dateTime ? new Date(evento.start.dateTime) : null;
    const fin = evento.end?.dateTime ? new Date(evento.end.dateTime) : null;
    if (!inicio || !fin) return null;

    const areaSlug = datosConsultas ? AREA_SLUG_CONSULTAS : AREA_SLUG_ESTETICA;
    const doctorPredeterminado = datosConsultas
      ? { nombre: 'Consultas Omega', apellidos: 'Generico' }
      : { nombre: 'Estética Omega', apellidos: 'Generico' };

    const [area, doctor, resuelto] = await Promise.all([
      areasRepository.findBySlug(areaSlug),
      repository.obtenerOCrearDoctorPredeterminado({ ...doctorPredeterminado, areaSlug }),
      resolverReserva(datos),
    ]);

    if (!area || !doctor) {
      logger.error(
        { eventoId: evento.id, areaSlug },
        `No se pudo importar la reserva: falta el área "${areaSlug}" (verifica que exista y esté activa) o no se pudo crear/obtener el doctor predeterminado.`,
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
      motivo: datosConsultas
        ? construirMotivo(datos, resuelto)
        : construirMotivoEstetica(datos, resuelto),
      estado: resuelto.estado,
      googleEventId: evento.id,
    });
  } catch (err) {
    logger.error({ err, eventoId: evento.id }, 'No se pudo importar una reserva externa.');
    return null;
  }
}

module.exports = {
  esReservaDeConsultas,
  esReservaDeEstetica,
  extraerDatosReserva,
  extraerDatosReservaEstetica,
  resolverReserva,
  importarReserva,
};
