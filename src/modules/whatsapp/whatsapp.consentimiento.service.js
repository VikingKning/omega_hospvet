const repository = require('./whatsapp.consentimiento.repository');
const configuracionService = require('../configuracion/configuracion.service');
const whatsappEnvios = require('./whatsapp.envios');
const outbox = require('./whatsapp.outbox');
const logger = require('../../config/logger');

async function subirAvisoVigenteAMeta() {
  const version = await configuracionService.obtenerVersionVigenteParaEnvio();
  if (!version) return null;

  const buffer = await configuracionService.leerArchivoAviso(version.archivo);
  const mediaId = await whatsappEnvios.subirMedia(buffer, 'application/pdf', version.nombreArchivo);
  return { mediaId, nombreArchivo: version.nombreArchivo };
}

async function enviarIntento(datosIntento, conversacionId, descripcionError) {
  const { intent } = await outbox.registrarIntento(datosIntento);
  let resultado;
  try {
    resultado = await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    resultado = { enviado: false, error: err.message };
  }
  if (!resultado.enviado) {
    logger.error(
      { conversacionId, error: resultado.error ?? resultado.motivo ?? null },
      descripcionError,
    );
  }
  return resultado;
}

async function enviarAvisoPrivacidad({ conversacionId, telefono, claveIdempotenciaBase }) {
  let subida;
  try {
    subida = await subirAvisoVigenteAMeta();
  } catch (err) {
    logger.error(
      { conversacionId, err },
      'No se pudo subir el aviso de privacidad a Meta (Media API).',
    );
    return { enviado: false, error: err.message };
  }
  if (!subida) return { enviado: false, motivo: 'sin_configurar' };

  const datosIntento = {
    claveIdempotencia: `${claveIdempotenciaBase}:lfpdppp_aviso`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'interactive',
      destinatarioTelefono: telefono,
      interactive: {
        type: 'button',
        header: {
          type: 'document',
          document: { id: subida.mediaId, filename: subida.nombreArchivo },
        },
        body: {
          text: 'Para continuar, ¿aceptas el aviso de privacidad y tratamiento de datos personales adjunto?',
        },
        action: {
          buttons: [
            { type: 'reply', reply: { id: repository.BOTON_ACEPTO_ID, title: 'Estoy de acuerdo' } },
            {
              type: 'reply',
              reply: { id: repository.BOTON_RECHAZO_ID, title: 'No estoy de acuerdo' },
            },
          ],
        },
      },
    },
    usaPlantilla: false,
  };

  return enviarIntento(
    datosIntento,
    conversacionId,
    'No se pudo enviar el aviso de privacidad de LFPDPPP.',
  );
}

// "Ver aviso de privacidad" del menú principal — reenvío informativo, sin
// botones de aceptar/rechazar: quien llega aquí ya pasó el gate de
// consentimiento (o la funcionalidad está apagada), así que es solo una
// consulta de transparencia (derechos ARCO), no una nueva solicitud.
async function enviarAvisoInformativo({ conversacionId, telefono, claveIdempotenciaBase }) {
  let subida;
  try {
    subida = await subirAvisoVigenteAMeta();
  } catch (err) {
    logger.error(
      { conversacionId, err },
      'No se pudo subir el aviso de privacidad a Meta (Media API) para el envío informativo.',
    );
    return { enviado: false, error: err.message };
  }
  if (!subida) return { enviado: false, motivo: 'sin_configurar' };

  const datosIntento = {
    claveIdempotencia: `${claveIdempotenciaBase}:lfpdppp_aviso_info`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'document',
      destinatarioTelefono: telefono,
      document: {
        id: subida.mediaId,
        filename: subida.nombreArchivo,
        caption: 'Aviso de privacidad y tratamiento de datos personales vigente.',
      },
    },
    usaPlantilla: false,
  };

  return enviarIntento(
    datosIntento,
    conversacionId,
    'No se pudo enviar el aviso de privacidad informativo por WhatsApp.',
  );
}

module.exports = { enviarAvisoPrivacidad, enviarAvisoInformativo };
