// Envío PROACTIVO de WhatsApp (resultados de laboratorio) — separado de
// whatsapp.service.js a propósito: ese módulo es solo el pipeline de
// mensajes ENTRANTES (webhook + clasificación), este es el negocio
// iniciando la conversación, un concepto distinto (y sujeto a la regla de
// Meta de "plantilla aprobada fuera de una ventana de 24h", ver README).
//
// Dos pasos siempre, en este orden: 1) subir el archivo real a Meta
// (subirMedia) para obtener un media id; 2) mandar la plantilla
// 'resultados_laboratorio_listos' (registrada una sola vez con
// scripts/registrar-plantilla-resultados-laboratorio.js) referenciando ese
// id en su encabezado de documento. Ninguna de las 2 funciones atrapa
// errores — tiran un Error normal si Meta responde con algo distinto de
// ok; laboratorio.envios.js es quien decide "nunca lanzar" hacia arriba.
const whatsapp = require('../../config/whatsapp');

const TEMPLATE_NAME = 'resultados_laboratorio_listos';
const TEMPLATE_LANGUAGE = 'es_MX';

// `propietarios.telefono` se guarda como 10 dígitos puros, SIN código de
// país (ver tutores.service.js#stripTelefono) — a propósito no se reusa
// normalizarNumeroSalida() de whatsapp.service.js: esa corrige el "1"
// extra de un número que YA llega con el prefijo 521... desde el webhook
// de Meta (mensajes entrantes), pero un teléfono de nuestra propia BD
// nunca tuvo código de país para empezar, ese caso no aplica aquí. Bug
// real encontrado en vivo: mandarlo tal cual (sin "52") hacía que Meta lo
// rechazara con "(#131030) Recipient phone number not in allowed list"
// aunque el número SÍ estuviera en la lista de destinatarios de prueba —
// sin el código de país, Meta no lo reconocía como el mismo número.
function formatearNumeroMexicano(telefono) {
  return `52${telefono}`;
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
  mediaId,
  nombreArchivo,
}) {
  const res = await fetch(whatsapp.messagesUrl(), {
    method: 'POST',
    headers: whatsapp.authHeaders(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: formatearNumeroMexicano(telefono),
      type: 'template',
      template: {
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
            ],
          },
        ],
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Meta rechazó el envío (HTTP ${res.status}).`);
  }
}

module.exports = { subirMedia, enviarPlantillaResultados };
