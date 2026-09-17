const laboratorioRepository = require('../laboratorio/laboratorio.repository');
const env = require('../../config/env');

const LAB_MISMO_TELEFONO_SI = 'LAB_MISMO_TELEFONO_SI';
const LAB_MISMO_TELEFONO_NO = 'LAB_MISMO_TELEFONO_NO';

const PG_INTEGER_MAX = 2147483647;

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

function textoPedirTelefonoYFolio() {
  return 'Por favor escríbenos el teléfono registrado del tutor y el folio de tu orden (ejemplo: 5512345678 LAB-005).';
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

function extraerFolioLibre(texto) {
  const fuente = String(texto ?? '');
  const match = fuente.match(/\blab[-\s]*0*(\d+)\b/i);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0 || id > PG_INTEGER_MAX) return null;
  const resto = fuente.slice(0, match.index) + fuente.slice(match.index + match[0].length);
  return { id, resto };
}

function extraerTelefonoLibre(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '');
  return digitos.length === 10 ? digitos : null;
}

function extraerFolioYTelefono(texto) {
  const folio = extraerFolioLibre(texto);
  if (!folio) return null;
  const telefonoDigits = extraerTelefonoLibre(folio.resto);
  if (!telefonoDigits) return null;
  return { folioId: folio.id, telefonoDigits };
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
        cambios: { paso_actual: 'esperando_telefono_y_folio' },
        labAccion: 'pedir_telefono_folio',
      };
    }
    return { cambios: {}, labAccion: 'confirmacion_ambigua' };
  }

  let folioId = null;
  let telefonoDigits = null;
  if (conversacion.paso_actual === 'esperando_folio') {
    if (tipoMensaje === 'text' && contenido) folioId = extraerFolio(contenido);
    telefonoDigits = ultimosDiezDigitos(conversacion.telefono_normalizado);
  } else if (conversacion.paso_actual === 'esperando_telefono_y_folio') {
    if (tipoMensaje === 'text' && contenido) {
      const extraido = extraerFolioYTelefono(contenido);
      if (extraido) {
        folioId = extraido.folioId;
        telefonoDigits = extraido.telefonoDigits;
      }
    }
  } else {
    return { cambios: {}, labAccion: null };
  }

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
  textoPedirTelefonoYFolio,
  textoRechazoGenerico,
  textoLimiteIntentos,
  textoEstadoOrden,
  extraerFolio,
  extraerFolioLibre,
  extraerTelefonoLibre,
  extraerFolioYTelefono,
  ultimosDiezDigitos,
  procesarPaso,
};
