const whatsapp = require('../../config/whatsapp');
const service = require('./whatsapp.service');

// Handshake de Meta al registrar el webhook (GET, una sola vez) — repite
// `hub.challenge` tal cual si `hub.verify_token` coincide con el valor que
// NOSOTROS configuramos (ver env.js), o rechaza con 403.
function verificar(req, res) {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (modo === 'subscribe' && whatsapp.esVerifyTokenValido(token)) {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.sendStatus(403);
}

// Claude solo clasifica TEXTO, nunca ve la imagen en sí — de un mensaje de
// foto (ej. para la plantilla "revision_herida_foto") se usa el `caption`
// (el texto que el tutor escribe junto a la foto) como si fuera el
// mensaje. Una foto sin caption no tiene texto que clasificar, se ignora
// igual que cualquier tipo de mensaje que no sea texto/imagen (audio,
// ubicación, etc.) y que cualquier entrada sin `value.messages` (recibos
// de entrega/lectura, que Meta manda al mismo endpoint).
function extraerTextoDelMensaje(mensaje) {
  if (mensaje.type === 'text') return mensaje.text?.body;
  if (mensaje.type === 'image') return mensaje.image?.caption;
  return undefined;
}

function extraerMensajesDeTexto(body) {
  const entradas = body?.entry ?? [];
  const mensajes = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      for (const mensaje of cambio.value?.messages ?? []) {
        const texto = extraerTextoDelMensaje(mensaje);
        if (texto) {
          mensajes.push({ from: mensaje.from, timestamp: mensaje.timestamp, texto });
        }
      }
    }
  }
  return mensajes;
}

// Recepción real de mensajes (POST). Verifica la firma ANTES que nada —
// 401 si no coincide (nunca 200 para una petición sin firmar por Meta de
// verdad). Con firma válida, procesa y SIEMPRE responde 200 al final. El
// try/catch va DENTRO del for, por mensaje — no envolviendo todo el bucle:
// desde que enviarRespuesta() empezó a lanzar en un rechazo de Meta (ver
// whatsapp.service.js#enviarRespuesta), un solo mensaje fallido dentro de
// un mismo lote de Meta ya no debe cortar el procesamiento de los demás
// mensajes de ese lote. Cualquier error queda logueado para revisar a
// mano, nunca provoca que Meta reintente agresivamente el mismo mensaje.
async function recibir(req, res) {
  const firmaValida = whatsapp.verificarFirma(req.rawBody, req.get('X-Hub-Signature-256'));
  if (!firmaValida) {
    return res.sendStatus(401);
  }

  const mensajes = extraerMensajesDeTexto(req.body);
  for (const mensaje of mensajes) {
    try {
      await service.procesarMensajeEntrante({
        telefono: mensaje.from,
        texto: mensaje.texto,
        recibidoEn: new Date(Number(mensaje.timestamp) * 1000),
      });
    } catch (err) {
      req.log.error({ err }, 'No se pudo procesar un mensaje entrante de WhatsApp.');
    }
  }

  return res.sendStatus(200);
}

module.exports = { verificar, recibir };
