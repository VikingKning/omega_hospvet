const whatsapp = require('../../config/whatsapp');
const logger = require('../../config/logger');
const repository = require('./whatsapp.repository');
const outbox = require('./whatsapp.outbox');
const { diagnosticoMeta } = require('./whatsapp.errores');

const TEMPLATE_NAME = 'resultados_laboratorio_listos_v2';
const TEMPLATE_LANGUAGE = 'es_MX';
const TEMPLATE_CATEGORIA_META = 'UTILITY';

function formatearNumeroMexicano(telefono) {
  const digitos = String(telefono ?? '').replace(/\D/g, '');
  if (/^\d{10}$/.test(digitos)) return `52${digitos}`;
  if (/^52\d{10}$/.test(digitos)) return digitos;
  if (/^521\d{10}$/.test(digitos)) return `52${digitos.slice(-10)}`;
  throw new Error('El teléfono del tutor no es un número mexicano válido.');
}

async function auditarEnvio(datos) {
  try {
    await repository.registrarEnvioWhatsapp(datos);
  } catch (err) {
    logger.error({ err }, 'No se pudo registrar la auditoría del envío de WhatsApp.');
  }
}

async function subirMedia(buffer, mimetype, nombreArchivo) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimetype);
  form.append('file', new Blob([buffer], { type: mimetype }), nombreArchivo);

  const res = await fetch(whatsapp.mediaUrl(), {
    method: 'POST',
    headers: whatsapp.bearerHeader(),
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    const error = new Error(
      data.error?.message || `Meta no aceptó el archivo (HTTP ${res.status}).`,
    );
    error.diagnosticoMeta = diagnosticoMeta(res, data);
    throw error;
  }
  return data.id;
}

async function enviarPlantillaResultados({
  telefono,
  nombreTutor,
  nombreMascota,
  folio,
  calendarUrl,
  mapsUrl,
  saludo,
  mediaId,
  nombreArchivo,
  claveIdempotencia,
}) {
  const destinatarioTelefono = formatearNumeroMexicano(telefono);
  const payloadFuncional = {
    tipo: 'template',
    destinatarioTelefono,
    plantilla: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANGUAGE },
      components: [
        {
          type: 'header',
          parameters: [{ type: 'document', document: { id: mediaId, filename: nombreArchivo } }],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nombreTutor },
            { type: 'text', text: nombreMascota },
            { type: 'text', text: folio },
            { type: 'text', text: calendarUrl },
            { type: 'text', text: mapsUrl },
            { type: 'text', text: saludo },
          ],
        },
      ],
    },
  };

  const { intent } = await outbox.registrarIntento({
    claveIdempotencia,
    tipoEnvio: 'laboratorio',
    origenFuncional: 'laboratorio',
    destinatarioTelefono,
    payloadFuncional,
    usaPlantilla: true,
    categoriaFacturacionMeta: TEMPLATE_CATEGORIA_META,
  });

  return ejecutarEnvioResultados(intent, destinatarioTelefono);
}

async function enviarResultadoLaboratorio(datos) {
  const destinatarioTelefono = formatearNumeroMexicano(datos.telefono);
  const ventana = await repository.buscarVentanaServicioCliente(destinatarioTelefono);
  if (!ventana) return enviarPlantillaResultados(datos);

  const tipo = ['image/jpeg', 'image/png'].includes(datos.mimetype) ? 'image' : 'document';
  const medio = {
    id: datos.mediaId,
    caption: `Resultados de laboratorio de ${datos.nombreMascota}. Folio ${datos.folio}.`,
    ...(tipo === 'document' ? { filename: datos.nombreArchivo } : {}),
  };

  const { intent } = await outbox.registrarIntento({
    claveIdempotencia: datos.claveIdempotencia,
    tipoEnvio: 'conversacional',
    origenFuncional: 'laboratorio',
    conversacionId: ventana.conversacionId,
    destinatarioTelefono,
    payloadFuncional: {
      tipo,
      finalidad: 'resultados_laboratorio',
      destinatarioTelefono,
      [tipo]: medio,
    },
    usaPlantilla: false,
  });

  return ejecutarEnvioResultados(intent, destinatarioTelefono);
}

async function ejecutarEnvioResultados(intent, destinatarioTelefono) {
  // registrarIntento conserva el payload original de una clave ya existente.
  // También conservamos su clase en la auditoría; jamás reemplazamos un envío
  // de resultado incierto por otro mensaje al cambiar la ventana de atención.
  const plantilla =
    intent.payload_funcional.tipo === 'template'
      ? intent.payload_funcional.plantilla.name
      : intent.payload_funcional.tipo === 'image'
        ? 'imagen_resultados_laboratorio'
        : 'documento_resultados_laboratorio';
  try {
    const resultado = await outbox.ejecutarIntento(intent.clave_idempotencia);
    if (!resultado.enviado) {
      const error = new Error(resultado.error || 'No se pudo enviar el documento de resultados.');
      error.errorCodigo = resultado.errorCodigo ?? resultado.motivo ?? null;
      error.diagnosticoMeta = resultado.diagnosticoMeta;
      throw error;
    }
    await auditarEnvio({ plantilla, destinatarioTelefono, exitoso: true, origen: 'laboratorio' });
  } catch (err) {
    await auditarEnvio({
      plantilla,
      destinatarioTelefono,
      exitoso: false,
      errorCodigo: err.errorCodigo ?? null,
      errorMensaje: err.message,
      origen: 'laboratorio',
    });
    throw err;
  }
}

module.exports = { subirMedia, enviarPlantillaResultados, enviarResultadoLaboratorio };
