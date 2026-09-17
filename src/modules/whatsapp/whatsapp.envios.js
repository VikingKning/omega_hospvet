const whatsapp = require('../../config/whatsapp');
const logger = require('../../config/logger');
const repository = require('./whatsapp.repository');
const outbox = require('./whatsapp.outbox');

const TEMPLATE_NAME = 'resultados_laboratorio_listos_v2';
const TEMPLATE_LANGUAGE = 'es_MX';
const TEMPLATE_CATEGORIA_META = 'UTILITY';

function formatearNumeroMexicano(telefono) {
  return `52${telefono}`;
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
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `Meta no aceptó el archivo (HTTP ${res.status}).`);
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

  let resultado;
  try {
    resultado = await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    await auditarEnvio({
      plantilla: TEMPLATE_NAME,
      destinatarioTelefono,
      exitoso: false,
      errorMensaje: err.message,
      origen: 'laboratorio',
    });
    throw err;
  }
  if (!resultado.enviado) {
    const error = new Error(resultado.error || 'Meta rechazó el envío.');
    await auditarEnvio({
      plantilla: TEMPLATE_NAME,
      destinatarioTelefono,
      exitoso: false,
      errorCodigo: resultado.errorCodigo ?? null,
      errorMensaje: error.message,
      origen: 'laboratorio',
    });
    throw error;
  }
  await auditarEnvio({
    plantilla: TEMPLATE_NAME,
    destinatarioTelefono,
    exitoso: true,
    origen: 'laboratorio',
  });
}

module.exports = { subirMedia, enviarPlantillaResultados };
