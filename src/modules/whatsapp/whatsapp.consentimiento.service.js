const repository = require('./whatsapp.consentimiento.repository');
const configuracionService = require('../configuracion/configuracion.service');
const whatsappEnvios = require('./whatsapp.envios');
const outbox = require('./whatsapp.outbox');
const logger = require('../../config/logger');

async function subirAvisoVigenteAMeta(version, mediaIdInvalido = null) {
  const mediaId = await configuracionService.asegurarMediaIdAviso(
    version,
    async () => {
      const buffer = await configuracionService.leerArchivoAviso(version.archivo);
      return whatsappEnvios.subirMedia(buffer, 'application/pdf', version.nombreArchivo);
    },
    mediaIdInvalido,
  );
  return { mediaId, nombreArchivo: version.nombreArchivo, version: version.version };
}

async function enviarIntento(datosIntento, conversacionId, descripcionError) {
  const { intent } = await outbox.registrarIntento(datosIntento);
  let resultado;
  try {
    resultado = await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    resultado = { enviado: false, error: err.message, diagnosticoMeta: err.diagnosticoMeta };
  }
  if (!resultado.enviado) {
    logger.error(
      {
        conversacionId,
        motivo: resultado.motivo ?? null,
        detalleTecnico: resultado.error ?? null,
        diagnosticoMeta: resultado.diagnosticoMeta ?? null,
      },
      descripcionError,
    );
  }
  const payload = intent.payload_funcional ?? datosIntento.payloadFuncional;
  return {
    ...resultado,
    mediaIdUsado: payload.interactive?.header?.document?.id ?? payload.document?.id,
  };
}

async function enviarConRenovacion(datosIntento, version, descripcionError) {
  const resultado = await enviarIntento(
    datosIntento,
    datosIntento.conversacionId,
    descripcionError,
  );
  // Solo un rechazo explicito del medio permite renovar y reintentar de
  // inmediato. Un timeout o error generico puede haber aceptado el envio.
  const medioInvalido = /not a valid whatsapp business account media attachment ID/i.test(
    `${resultado.error ?? ''} ${resultado.diagnosticoMeta?.detalle ?? ''}`,
  );
  if (resultado.enviado || !medioInvalido) return resultado;

  try {
    const subida = await subirAvisoVigenteAMeta(version, resultado.mediaIdUsado);
    const payload = structuredClone(datosIntento.payloadFuncional);
    if (payload.interactive) payload.interactive.header.document.id = subida.mediaId;
    else payload.document.id = subida.mediaId;
    // El intento original queda intacto como evidencia del rechazo.
    // La clave estable evita duplicar la recuperacion del mismo mensaje.
    return await enviarIntento(
      {
        ...datosIntento,
        claveIdempotencia: `${datosIntento.claveIdempotencia}:media_renovado`,
        payloadFuncional: payload,
      },
      datosIntento.conversacionId,
      descripcionError,
    );
  } catch (err) {
    logger.error(
      {
        conversacionId: datosIntento.conversacionId,
        detalleTecnico: err.message,
        diagnosticoMeta: err.diagnosticoMeta ?? null,
      },
      'No se pudo renovar el archivo del aviso de privacidad en Meta.',
    );
    return { enviado: false, error: err.message, diagnosticoMeta: err.diagnosticoMeta };
  }
}

async function enviarAvisoPrivacidad({ conversacionId, telefono, claveIdempotenciaBase }) {
  const funcionesWhatsapp = await configuracionService.obtenerConfiguracionWhatsapp();
  if (!funcionesWhatsapp.respuestasAutomaticas || !funcionesWhatsapp.avisoPrivacidad) {
    return { enviado: false, motivo: 'funcion_deshabilitada' };
  }
  let subida;
  let version;
  try {
    version = await configuracionService.obtenerVersionVigenteParaEnvio();
    if (!version) return { enviado: false, motivo: 'sin_configurar' };
    const reclamado = await repository.reclamarEnvioAviso(telefono, version.version);
    if (!reclamado) return { enviado: false, motivo: 'aviso_en_espera' };
    subida = await subirAvisoVigenteAMeta(version);
  } catch (err) {
    logger.error(
      { conversacionId, detalleTecnico: err.message, diagnosticoMeta: err.diagnosticoMeta ?? null },
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
          text:
            `Para continuar, es necesario que aceptes la última versión (${subida.version}) ` +
            'del aviso de privacidad y tratamiento de datos personales adjunto. ¿Aceptas?',
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

  return enviarConRenovacion(
    datosIntento,
    version,
    'No se pudo enviar el aviso de privacidad de LFPDPPP.',
  );
}

// "Ver aviso de privacidad" del menú principal — reenvío informativo, sin
// botones de aceptar/rechazar: quien llega aquí ya pasó el gate de
// consentimiento (o la funcionalidad está apagada), así que es solo una
// consulta de transparencia (derechos ARCO), no una nueva solicitud.
async function enviarAvisoInformativo({ conversacionId, telefono, claveIdempotenciaBase }) {
  const funcionesWhatsapp = await configuracionService.obtenerConfiguracionWhatsapp();
  if (!funcionesWhatsapp.respuestasAutomaticas || !funcionesWhatsapp.avisoPrivacidad) {
    return { enviado: false, motivo: 'funcion_deshabilitada' };
  }
  let subida;
  let version;
  try {
    version = await configuracionService.obtenerVersionVigenteParaEnvio();
    if (!version) return { enviado: false, motivo: 'sin_configurar' };
    subida = await subirAvisoVigenteAMeta(version);
  } catch (err) {
    logger.error(
      { conversacionId, detalleTecnico: err.message, diagnosticoMeta: err.diagnosticoMeta ?? null },
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
        caption:
          'Compartimos el documento de Aviso de privacidad y tratamiento de datos personales vigente.',
      },
    },
    usaPlantilla: false,
  };

  return enviarConRenovacion(
    datosIntento,
    version,
    'No se pudo enviar el aviso de privacidad informativo por WhatsApp.',
  );
}

module.exports = { enviarAvisoPrivacidad, enviarAvisoInformativo };
