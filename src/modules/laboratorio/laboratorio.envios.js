// Envío real de resultados de laboratorio (pedido explícito del usuario:
// por WhatsApp y/o correo, según qué dato de contacto tenga el tutor) —
// capa aparte del repository/service, igual criterio que
// laboratorio.archivos.js: habla con servicios EXTERNOS (SMTP/Graph API),
// no con la base de datos. Ninguna de las 2 funciones lanza — un canal que
// falla nunca debe tumbar al otro ni la respuesta al usuario; se loguea y
// se regresa { ok:false, error } para que laboratorio.service.js decida
// qué reportar.
const fs = require('fs/promises');
const path = require('path');
const env = require('../../config/env');
const logger = require('../../config/logger');
const email = require('../../config/email');
const whatsappEnvios = require('../whatsapp/whatsapp.envios');
const correoResultados = require('./laboratorio.correoResultados');

// Mismo logo que usa todo el resto del sistema (sidebar, login, etc.) — se
// manda como adjunto con Content-ID en vez de una URL pública porque este
// sistema no tiene un dominio que sirva `public/` fuera de la red de la
// clínica (ver laboratorio.correoResultados.js).
const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'imgs', 'icon.png');

// Mismo criterio que idLabel() en laboratorio-panel.ejs/laboratorio-form.ejs/
// laboratorio.correoResultados.js (módulos de dominio deliberadamente
// independientes, no se cruza este helper minúsculo entre archivos) —
// aquí solo el número con padding, sin el prefijo "LAB-": ese prefijo va
// como texto literal dentro del body de la plantilla de WhatsApp (ver
// whatsapp.envios.js#enviarPlantillaResultados).
function folioNumero(id) {
  return String(id).padStart(3, '0');
}

// Saludo según la hora real de envío en la zona horaria de la clínica
// (pedido explícito del usuario) — se calcula en cada envío, nunca se
// guarda. Intl con hour12:false puede regresar "24" para la medianoche en
// vez de "0" (quirk conocido de ICU en en-US), de ahí la normalización.
function saludoPorHora() {
  let hora = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  );
  if (hora === 24) hora = 0;
  if (hora < 12) return 'día';
  if (hora < 19) return 'tarde';
  return 'noche';
}

async function enviarPorCorreo({
  destinatario,
  nombreTutor,
  nombreMascota,
  fechaSolicitud,
  folioId,
  archivos,
  calendarioCitas,
  googleMapsUrl,
}) {
  try {
    const transporter = email.getTransporter();
    const { subject, html, text } = correoResultados.construirCorreoResultados({
      nombreTutor,
      nombreMascota,
      fechaSolicitud,
      folioId,
      archivos,
      calendarioCitas,
      googleMapsUrl,
    });
    await transporter.sendMail({
      from: env.email.from,
      to: destinatario,
      subject,
      text,
      html,
      attachments: [
        { filename: 'omega-logo.png', path: LOGO_PATH, cid: 'logo-omega' },
        ...archivos.map((a) => ({ filename: a.nombreOriginal, path: a.rutaAbsoluta })),
      ],
    });
    return { ok: true };
  } catch (err) {
    logger.error(
      { err, destinatario },
      'No se pudo enviar el correo de resultados de laboratorio.',
    );
    return { ok: false, error: err.message };
  }
}

// Un mensaje de plantilla solo admite UN documento en su encabezado — con
// varios archivos distintos (uno por estudio, en vez del camino habitual
// "un archivo para todos") se manda una plantilla por archivo. Éxito solo
// si TODOS salen bien; el primero que falle corta el resto (mismo criterio
// que "nunca a medias" del resto del proyecto para este tipo de acción).
async function enviarPorWhatsapp({
  telefono,
  nombreTutor,
  nombreMascota,
  folioId,
  archivos,
  googleCalendarMeetingUrl,
  googleMapsUrl,
}) {
  try {
    const folio = folioNumero(folioId);
    const saludo = saludoPorHora();
    for (const archivo of archivos) {
      const buffer = await fs.readFile(archivo.rutaAbsoluta);
      const mediaId = await whatsappEnvios.subirMedia(
        buffer,
        archivo.mimetype,
        archivo.nombreOriginal,
      );
      await whatsappEnvios.enviarPlantillaResultados({
        telefono,
        nombreTutor,
        nombreMascota,
        folio,
        calendarUrl: googleCalendarMeetingUrl,
        mapsUrl: googleMapsUrl,
        saludo,
        mediaId,
        nombreArchivo: archivo.nombreOriginal,
      });
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err, telefono }, 'No se pudo enviar el WhatsApp de resultados de laboratorio.');
    return { ok: false, error: err.message };
  }
}

module.exports = { enviarPorCorreo, enviarPorWhatsapp };
