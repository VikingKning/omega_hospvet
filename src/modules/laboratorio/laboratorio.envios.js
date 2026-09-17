const fs = require('fs/promises');
const path = require('path');
const env = require('../../config/env');
const logger = require('../../config/logger');
const email = require('../../config/email');
const whatsappEnvios = require('../whatsapp/whatsapp.envios');
const correoResultados = require('./laboratorio.correoResultados');

const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'imgs', 'icon.png');

function folioNumero(id) {
  return String(id).padStart(3, '0');
}

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

async function enviarPorWhatsapp({
  telefono,
  nombreTutor,
  nombreMascota,
  folioId,
  archivos,
  googleCalendarMeetingUrl,
  googleMapsUrl,
  claveIdempotenciaPrefijo = `laboratorio:${folioId}`,
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
        claveIdempotencia: `${claveIdempotenciaPrefijo}:${archivo.id}`,
      });
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err, telefono }, 'No se pudo enviar el WhatsApp de resultados de laboratorio.');
    return { ok: false, error: err.message };
  }
}

module.exports = { enviarPorCorreo, enviarPorWhatsapp };
