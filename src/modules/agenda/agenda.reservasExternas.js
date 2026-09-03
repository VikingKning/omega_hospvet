// Importa reservas hechas por el cliente vía la página de reservas de
// Google Calendar ("Appointment Scheduling") de Consultas — pedido
// explícito del usuario, verificado contra un evento real de prueba.
// Disparado desde agenda.googleSync.js#sincronizar() para cualquier
// evento del calendario compartido que NO traiga nuestro
// extendedProperties.private.citaId (no lo creamos nosotros).
//
// Reglas de match que dio el usuario, textuales: 1) teléfono coincide con
// un tutor Y el nombre de mascota coincide con una de sus mascotas -> la
// cita se cierra sola (estado 'confirmada'); 2) teléfono coincide pero la
// mascota no -> se asigna el tutor, mascota queda pendiente; 3) ni el
// teléfono matchea -> ni tutor ni mascota, el staff completa todo a mano.
// Los casos 2 y 3 nacen 'registrada' — mismo estado que el schema
// original ya reservaba para "nace sin intervención de staff, pero
// necesita confirmarse" (ver agenda.service.js#confirmar).
const logger = require('../../config/logger');
const repository = require('./agenda.repository');
const areasRepository = require('../areas/areas.repository');
const tutoresRepository = require('../tutores/tutores.repository');

const AREA_SLUG_CONSULTAS = 'consultas';

// Pedido explícito del usuario: el mismo Google Calendar puede tener OTRAS
// páginas de reservas (Appointment Scheduling) para servicios que no son
// Consultas — sin este doble chequeo, cualquier evento sin citaId que por
// coincidencia comparta el mensaje de bienvenida ("Estamos felices de
// recibirte", texto genérico que el usuario pudo haber reusado en otra
// página) se importaba igual, aunque fuera la sesión de otra cosa. Ahora
// hacen falta AMBAS señales: el título trae el nombre de la página de
// reservas (`evento.summary`, confirmado contra `agenda.googleSync.js`
// donde el propio sistema lo llena igual al empujar una cita) y la
// descripción trae el texto propio de ESTA página específica.
const SENAL_TITULO = 'Consultas Veterinarias';

// Bug real encontrado en vivo (antes de este doble chequeo): se usaba el
// literal "Nombre de la Mascota" (la pregunta personalizada) como única
// señal, pero esa pregunta es OPCIONAL en el formulario de Google — dos
// reservas reales del usuario (mismo teléfono, sin esa pregunta
// contestada) se ignoraron por completo. Este texto, en cambio, es la
// descripción fija de la página de reservas de Consultas (la que ve el
// cliente al agendar) — sale igual en TODA reserva de esta página exista
// o no la respuesta de mascota, y es específico de este servicio (a
// diferencia del mensaje de bienvenida genérico). Se usa solo la primera
// oración completa: confirmado contra el HTML real que regresa la API, esa
// oración vive entera dentro de un único <p>, así que quitarHtml() nunca
// la parte a la mitad (a diferencia de la oración siguiente, que empieza
// en OTRO <p> — no hay garantía de que sobreviva el espacio entre ambas).
const SENAL_DESCRIPCION =
  'Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla.';

// Pedido explícito del usuario: el cliente puede escribir el teléfono en el
// formulario de Google con o sin separadores ("5529000090", "55-2900-0090",
// "55 29 00 00 90", "55 2900 0090"...) — se captura cualquier corrida de
// dígitos/espacios/guiones acotada (9 a 15 caracteres en total, cualquier
// otro carácter — letras, saltos de línea seguidos de texto, emojis — la
// corta) y se valida en extraerTelefono() de abajo que, ya sin separadores,
// queden exactamente 10 dígitos (mismo criterio de "guardado sin guiones"
// que tutores.service.js#stripTelefono).
const REGEX_TELEFONO_CANDIDATO = /\b(\d[\d\s-]{7,13}\d)\b/;
const REGEX_MASCOTA = /Nombre de la Mascota\s*\n+([^\n]+)/i;
const REGEX_TUTOR = /Programada por\s*\n+([^\n]+)/;
const REGEX_CORREO = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// Pedido explícito del usuario: preservar el motivo de consulta que
// escribe el cliente (pregunta opcional del formulario, igual que
// "Nombre de la Mascota" — puede no venir).
const REGEX_MOTIVO_CONSULTA = /Motivo de Consulta:?\s*\n+([^\n]+)/i;

// Mismo patrón que areas.service.js#normalizeNombre/
// plantillas_whatsapp.service.js#normalizeIntencion, duplicado a
// propósito (módulos de dominio independientes entre sí, ya establecido
// en este proyecto).
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

// El `description` real que regresa la API viene en HTML (confirmado en
// vivo: "<b>Programada por</b>\nOmegaTest VetOmega\n..."), no en texto
// plano como se ve en "Detalles del Evento" de la interfaz de Google
// Calendar — quitar las etiquetas deja los saltos de línea intactos (ya
// eran literales en el texto, las etiquetas no los reemplazan), así los
// regex de abajo funcionan igual que contra texto plano.
function quitarHtml(texto) {
  return texto.replace(/<[^>]+>/g, '');
}

// Quita espacios/guiones del candidato encontrado y valida que, ya limpio,
// sean exactamente 10 dígitos — un candidato más largo/corto (otro número
// cualquiera del texto que por coincidencia cumpla el patrón) se descarta
// en vez de guardarse a medias.
function extraerTelefono(texto) {
  const candidato = texto.match(REGEX_TELEFONO_CANDIDATO)?.[1];
  if (!candidato) return null;
  const digitos = candidato.replace(/[\s-]/g, '');
  return digitos.length === 10 ? digitos : null;
}

// Regresa null si el título+descripción no traen ambas señales (no es una
// reserva de Consultas que reconozcamos) — cualquier otro campo
// individual que no se encuentre (teléfono/mascota/tutor/correo) se
// regresa en null, nunca truena.
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

// Regresa { propietarioId, mascotaId, estado } según cuál de los 3 casos
// de arriba aplica.
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

// Texto propio y corto — NUNCA el bloque completo de instrucciones fijas
// que trae el evento real (ver el ejemplo en el plan de esta ronda).
// Pedido explícito del usuario: el motivo de consulta que escribió el
// cliente se preserva tal cual, primero (es el dato clínicamente
// relevante para el doctor) — el resto sigue siendo contexto
// administrativo de la reserva (para que el staff pueda completarla si
// hace falta).
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

// Orquesta todo para un evento del calendario sin citaId. Regresa el id
// de la cita nueva, o null si no se importó (no es una reserva
// reconocida, ya se había importado antes, o algo falló) — nunca lanza,
// mismo criterio que pushCita: un error se loguea y ese evento se
// reintenta en el siguiente ciclo.
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
