const db = require('../../config/database');

// Deliberadamente sin dependencia de whatsapp.outbox.js: whatsapp.repository.js
// (que SÍ requiere este archivo) es una dependencia de whatsapp.outbox.js, así
// que este archivo nunca puede requerir outbox sin crear un ciclo. El envío
// real del aviso vive en whatsapp.consentimiento.service.js, que solo
// requiere whatsapp.service.js (una capa por encima de outbox/repository).

// "Un día" per el diseño acordado con el usuario (2026-09-19): pasada esta
// ventana sin respuesta (o tras un rechazo), se vuelve a preguntar en vez
// de dejar a alguien bloqueado para siempre por una decisión vieja. Las
// filas nunca se borran — quedan como evidencia de que se preguntó.
const VENTANA_REASK_HORAS = 24;

const BOTON_ACEPTO_ID = 'lfpdppp_acepto';
const BOTON_RECHAZO_ID = 'lfpdppp_rechazo';

const ESTADOS = Object.freeze({
  ACEPTADO: 'aceptado',
  PENDIENTE_VIGENTE: 'pendiente_vigente',
  RECHAZADO_RECIENTE: 'rechazado_reciente',
  NECESITA_PREGUNTAR: 'necesita_preguntar',
});

function horasDesde(fecha) {
  return (Date.now() - new Date(fecha).getTime()) / 3_600_000;
}

function esRespuestaBoton(tipoMensaje, contenido) {
  return (
    tipoMensaje === 'interactive_button_reply' &&
    (contenido === BOTON_ACEPTO_ID || contenido === BOTON_RECHAZO_ID)
  );
}

async function buscarUltimoRegistro(telefono, trx) {
  const conexion = trx ?? db;
  return conexion('consentimiento_lfpdppp')
    .where({ telefono })
    .orderBy('creado_en', 'desc')
    .first();
}

async function evaluarEstado(telefono, trx) {
  const fila = await buscarUltimoRegistro(telefono, trx);
  if (!fila) return { estado: ESTADOS.NECESITA_PREGUNTAR, fila: null };
  if (fila.acepto === true) return { estado: ESTADOS.ACEPTADO, fila };

  const referencia =
    fila.acepto === null ? (fila.aviso_enviado_en ?? fila.creado_en) : fila.creado_en;
  const vigente = horasDesde(referencia) < VENTANA_REASK_HORAS;

  if (fila.acepto === null) {
    return vigente
      ? { estado: ESTADOS.PENDIENTE_VIGENTE, fila }
      : { estado: ESTADOS.NECESITA_PREGUNTAR, fila: null };
  }
  return vigente
    ? { estado: ESTADOS.RECHAZADO_RECIENTE, fila }
    : { estado: ESTADOS.NECESITA_PREGUNTAR, fila: null };
}

async function insertarPendiente({ telefono, propietarioId, avisoEnviadoEn }, trx) {
  const conexion = trx ?? db;
  const [fila] = await conexion('consentimiento_lfpdppp')
    .insert({
      telefono,
      propietario_id: propietarioId ?? null,
      acepto: null,
      canal: 'whatsapp',
      aviso_enviado_en: avisoEnviadoEn,
    })
    .returning('*');
  return fila;
}

async function resolverPendiente({ id, acepto, wamid }, trx) {
  const conexion = trx ?? db;
  const [fila] = await conexion('consentimiento_lfpdppp')
    .where({ id })
    .update({ acepto, wamid: wamid ?? null })
    .returning('*');
  return fila;
}

// Alta de propietario en el panel (US-156): se asume que recepción ya
// recabó el consentimiento físico al momento del alta.
async function insertarConsentimientoPanel({ telefono, propietarioId }, trx) {
  const conexion = trx ?? db;
  const [fila] = await conexion('consentimiento_lfpdppp')
    .insert({ telefono, propietario_id: propietarioId, acepto: true, canal: 'panel' })
    .returning('*');
  return fila;
}

module.exports = {
  ESTADOS,
  BOTON_ACEPTO_ID,
  BOTON_RECHAZO_ID,
  esRespuestaBoton,
  evaluarEstado,
  buscarUltimoRegistro,
  insertarPendiente,
  resolverPendiente,
  insertarConsentimientoPanel,
};
