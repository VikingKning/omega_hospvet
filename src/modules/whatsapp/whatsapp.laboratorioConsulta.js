const laboratorioRepository = require('../laboratorio/laboratorio.repository');
const env = require('../../config/env');

const LAB_MISMO_TELEFONO_SI = 'LAB_MISMO_TELEFONO_SI';
const LAB_MISMO_TELEFONO_NO = 'LAB_MISMO_TELEFONO_NO';

function preguntaConfirmacionPayload() {
  return {
    type: 'button',
    body: {
      text: '¿Nos escribes desde el mismo teléfono que tenemos registrado en Omega para el tutor de tu mascota?',
    },
    action: {
      buttons: [
        { type: 'reply', reply: { id: LAB_MISMO_TELEFONO_SI, title: 'Sí' } },
        { type: 'reply', reply: { id: LAB_MISMO_TELEFONO_NO, title: 'No' } },
      ],
    },
  };
}

function textoPedirFolio() {
  return 'Por favor escríbenos el folio de tu orden (ejemplo: LAB-005).';
}

function textoTelefonoNoRegistrado() {
  return 'Por seguridad y protección de tus datos personales, los resultados de laboratorio solo pueden enviarse al número registrado del tutor. Por favor, escríbenos desde ese número o comunícate con Recepción para actualizar tus datos.';
}

function textoRechazoGenerico() {
  return 'No encontramos ninguna orden con esos datos. Verifica el folio y el teléfono, y vuelve a intentarlo.';
}

function textoLimiteIntentos() {
  return 'Por seguridad, hemos bloqueado esta consulta. Por favor acércate a la sucursal para atender mejor tu consulta.';
}

function textoEstadoOrden(folioId, estadoOrden) {
  const folio = `LAB-${String(folioId).padStart(3, '0')}`;
  const descripciones = {
    pendiente: `Tu orden ${folio} sigue en proceso. Te avisaremos en cuanto tus resultados estén listos.`,
    cargado: `Los resultados de tu orden ${folio} ya están listos. Pronto nos pondremos en contacto contigo para hacértelos llegar.`,
    enviado: `Los resultados de tu orden ${folio} ya fueron enviados. Si no los recibiste, contáctanos directamente.`,
  };
  return descripciones[estadoOrden] ?? `Tu orden ${folio} está en estado: ${estadoOrden}.`;
}

function extraerFolio(texto) {
  const id = laboratorioRepository.extraerIdBuscado(String(texto ?? '').trim());
  return id !== null && id > 0 ? id : null;
}

function ultimosDiezDigitos(telefonoNormalizado) {
  return String(telefonoNormalizado ?? '').slice(-10);
}

function registrarIntentoFallido(conversacion, ahora) {
  const intentos = (conversacion.intentos_validacion_lab ?? 0) + 1;
  if (intentos >= env.whatsapp.labMaxIntentos) {
    return {
      cambios: {
        estado: 'cerrada',
        cerrado_en: ahora,
        flujo_actual: null,
        paso_actual: null,
        intentos_validacion_lab: intentos,
      },
      labAccion: 'limite_intentos',
      intentos,
    };
  }
  return {
    cambios: { intentos_validacion_lab: intentos },
    labAccion: 'rechazo',
    intentos,
  };
}

async function procesarPaso(trx, conversacion, { contenido, tipoMensaje, ahora }) {
  if (conversacion.paso_actual === 'confirmando_telefono') {
    if (tipoMensaje === 'interactive_button_reply' && contenido === LAB_MISMO_TELEFONO_SI) {
      return { cambios: { paso_actual: 'esperando_folio' }, labAccion: 'pedir_folio' };
    }
    if (tipoMensaje === 'interactive_button_reply' && contenido === LAB_MISMO_TELEFONO_NO) {
      return {
        cambios: { paso_actual: 'aviso_privacidad_pendiente' },
        labAccion: 'telefono_no_coincide',
      };
    }
    return { cambios: {}, labAccion: 'confirmacion_ambigua' };
  }

  let folioId = null;
  if (conversacion.paso_actual === 'esperando_folio') {
    if (tipoMensaje === 'text' && contenido) folioId = extraerFolio(contenido);
  } else if (
    conversacion.paso_actual === 'aviso_privacidad_pendiente' ||
    conversacion.paso_actual === 'esperando_telefono_y_folio'
  ) {
    // La segunda condición conserva de forma segura conversaciones iniciadas
    // antes del cambio: ya no se procesan teléfonos ni folios alternativos.
    return { cambios: {}, labAccion: 'telefono_no_coincide' };
  } else {
    return { cambios: {}, labAccion: null };
  }

  const telefonoDigits = ultimosDiezDigitos(conversacion.telefono_normalizado);
  if (folioId === null || telefonoDigits === null || telefonoDigits.length !== 10) {
    return registrarIntentoFallido(conversacion, ahora);
  }

  const registro = await laboratorioRepository.findByFolioYTelefono(folioId, telefonoDigits, trx);
  if (!registro) {
    return registrarIntentoFallido(conversacion, ahora);
  }

  return {
    cambios: {
      estado: 'cerrada',
      cerrado_en: ahora,
      flujo_actual: null,
      paso_actual: null,
      intentos_validacion_lab: null,
    },
    labAccion: 'exito',
    labDatos: { folioId: registro.id, estadoOrden: registro.estado },
  };
}

module.exports = {
  LAB_MISMO_TELEFONO_SI,
  LAB_MISMO_TELEFONO_NO,
  preguntaConfirmacionPayload,
  textoPedirFolio,
  textoTelefonoNoRegistrado,
  textoRechazoGenerico,
  textoLimiteIntentos,
  textoEstadoOrden,
  extraerFolio,
  ultimosDiezDigitos,
  procesarPaso,
};
