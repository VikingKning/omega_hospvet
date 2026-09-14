// US WA 007 — consulta segura de resultados de laboratorio por WhatsApp.
// Reglas 100% deterministas (AC11): ni este archivo ni whatsapp.repository.js
// llaman nunca a Claude para decidir nada de este flujo. Vive separado de
// whatsapp.menu.js porque es un concern propio (un flujo con pasos y una
// consulta de identidad cruzando a otro módulo), no configuración de UI.
const laboratorioRepository = require('../laboratorio/laboratorio.repository');
const env = require('../../config/env');

// Consideración técnica: "Definir... como constantes" — mismo criterio que
// MENU_*/RESPUESTA_* ya establecidos (id interno estable, nunca se decide
// nada por el título visible).
const LAB_MISMO_TELEFONO_SI = 'LAB_MISMO_TELEFONO_SI';
const LAB_MISMO_TELEFONO_NO = 'LAB_MISMO_TELEFONO_NO';

// Mismo límite que laboratorio.repository.js#PG_INTEGER_MAX — duplicado
// aquí a propósito porque esa constante no se exporta (es un detalle de
// implementación de extraerIdBuscado, ya aplicado dentro de esa función);
// esta copia es solo para el guard adicional de extraerFolioLibre.
const PG_INTEGER_MAX = 2147483647;

// AC1 (US WA 007): pregunta de confirmación con botones Sí/No — mismo
// criterio de "configuración controlada" ya usado en whatsapp.menu.js.
// ASUNCIÓN DE CONTENIDO: no hay copy verbatim en la historia.
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

// AC2. ASUNCIÓN DE CONTENIDO.
function textoPedirFolio() {
  return 'Por favor escríbenos el folio de tu orden (ejemplo: LAB-005).';
}

// AC3. ASUNCIÓN DE CONTENIDO.
function textoPedirTelefonoYFolio() {
  return 'Por favor escríbenos el teléfono registrado del tutor y el folio de tu orden (ejemplo: 5512345678 LAB-005).';
}

// AC9 (y también AC6): el MISMO texto para "no coincide" y para "formato
// inválido" — usar textos distintos filtraría información (AC9 exige que
// el mensaje "no confirme si el folio, teléfono, tutor, paciente u orden
// existen"; distinguir "tu formato estaba mal" de "no encontramos nada"
// ya sería revelar algo). ASUNCIÓN DE CONTENIDO.
function textoRechazoGenerico() {
  return 'No encontramos ninguna orden con esos datos. Verifica el folio y el teléfono, y vuelve a intentarlo.';
}

// AC10. ASUNCIÓN DE CONTENIDO.
function textoLimiteIntentos() {
  return 'Por seguridad, hemos bloqueado esta consulta. Por favor acércate a la sucursal para atender mejor tu consulta.';
}

// AC8: únicamente el estado de la orden — nunca nombre de tutor/paciente,
// estudios, ni ningún otro dato. ASUNCIÓN DE CONTENIDO (los 3 estados
// vienen de laboratorio.repository.js: pendiente/cargado/enviado).
function textoEstadoOrden(folioId, estadoOrden) {
  const folio = `LAB-${String(folioId).padStart(3, '0')}`;
  const descripciones = {
    pendiente: `Tu orden ${folio} sigue en proceso. Te avisaremos en cuanto tus resultados estén listos.`,
    cargado: `Los resultados de tu orden ${folio} ya están listos. Pronto nos pondremos en contacto contigo para hacértelos llegar.`,
    enviado: `Los resultados de tu orden ${folio} ya fueron enviados. Si no los recibiste, contáctanos directamente.`,
  };
  return descripciones[estadoOrden] ?? `Tu orden ${folio} está en estado: ${estadoOrden}.`;
}

// AC2: el mensaje COMPLETO debe ser el folio — reutiliza tal cual
// laboratorio.repository.js#extraerIdBuscado (consideración técnica:
// "reutilizar... la extracción de folio de laboratorio.repository.js").
// AC6: además del formato, rechaza un folio no positivo (extraerIdBuscado
// por sí solo acepta 0 — "LAB-0" — porque para el buscador interno del
// panel esa validación adicional no aplicaba).
function extraerFolio(texto) {
  const id = laboratorioRepository.extraerIdBuscado(String(texto ?? '').trim());
  return id !== null && id > 0 ? id : null;
}

// AC3: el folio puede venir en cualquier parte del texto (junto con el
// teléfono) — a diferencia de extraerFolio, no exige que el mensaje
// COMPLETO sea el folio. Regresa también el resto del texto (con el folio
// ya recortado) para poder buscar el teléfono en lo que queda, sin que un
// "005" del propio folio se confunda con parte del teléfono.
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

// AC3 completo: folio + teléfono en el mismo mensaje.
function extraerFolioYTelefono(texto) {
  const folio = extraerFolioLibre(texto);
  if (!folio) return null;
  const telefonoDigits = extraerTelefonoLibre(folio.resto);
  if (!telefonoDigits) return null;
  return { folioId: folio.id, telefonoDigits };
}

// AC2: "el teléfono de origen normalizado" — telefono_normalizado se
// guarda como 52XXXXXXXXXX (WA002); propietarios.telefono son los 10
// dígitos sin el 52 (US-155/normalización ya existente en tutores/laboratorio).
function ultimosDiezDigitos(telefonoNormalizado) {
  return String(telefonoNormalizado ?? '').slice(-10);
}

// AC10: intento fallido (formato inválido O sin coincidencia, AC6/AC9) —
// incrementa el contador y decide si ya se alcanzó el límite.
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

// Núcleo del flujo (AC1-AC10) — recibe la conversación YA en
// flujo_actual='consulta_laboratorio' y decide, según paso_actual, qué
// cambios aplicar y qué debe enviarse después (whatsapp.service.js). Hace
// la consulta a laboratorio.repository.js DENTRO de la misma `trx` que
// whatsapp.repository.js#aplicarReglasDeInteraccion, para que el resultado
// de la validación y el contador de intentos se confirmen atómicamente
// junto con el resto del mensaje entrante.
async function procesarPaso(trx, conversacion, { contenido, tipoMensaje, ahora }) {
  if (conversacion.paso_actual === 'confirmando_telefono') {
    if (tipoMensaje === 'interactive_button_reply' && contenido === LAB_MISMO_TELEFONO_SI) {
      return { cambios: { paso_actual: 'esperando_folio' }, labAccion: 'pedir_folio' }; // AC2
    }
    if (tipoMensaje === 'interactive_button_reply' && contenido === LAB_MISMO_TELEFONO_NO) {
      return {
        cambios: { paso_actual: 'esperando_telefono_y_folio' },
        labAccion: 'pedir_telefono_folio',
      }; // AC3
    }
    return { cambios: {}, labAccion: 'confirmacion_ambigua' }; // AC4: sin consultar la orden.
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
    return registrarIntentoFallido(conversacion, ahora); // AC6
  }

  const registro = await laboratorioRepository.findByFolioYTelefono(folioId, telefonoDigits, trx);
  if (!registro) {
    return registrarIntentoFallido(conversacion, ahora); // AC9
  }

  // AC8/AC13-análogo: éxito — cierra el flujo, ya se entregó lo único que
  // esta historia autoriza a revelar (el estado).
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
