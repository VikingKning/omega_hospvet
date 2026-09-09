// Envío real de resultados de laboratorio (pedido explícito del usuario:
// por WhatsApp y/o correo, según qué dato de contacto tenga el tutor) —
// capa aparte del repository/service, igual criterio que
// laboratorio.archivos.js: habla con servicios EXTERNOS (SMTP/Graph API),
// no con la base de datos. Ninguna de las 2 funciones lanza — un canal que
// falla nunca debe tumbar al otro ni la respuesta al usuario; se loguea y
// se regresa { ok:false, error } para que laboratorio.service.js decida
// qué reportar.
const fs = require('fs/promises');
const env = require('../../config/env');
const logger = require('../../config/logger');
const email = require('../../config/email');
const whatsappEnvios = require('../whatsapp/whatsapp.envios');

async function enviarPorCorreo({ destinatario, nombreTutor, nombreMascota, archivos }) {
  try {
    const transporter = email.getTransporter();
    await transporter.sendMail({
      from: env.email.from,
      to: destinatario,
      subject: `Resultados de laboratorio de ${nombreMascota}`,
      text:
        `Hola ${nombreTutor},\n\n` +
        `Los resultados de laboratorio de ${nombreMascota} ya están listos. ` +
        `Los encontrarás adjuntos a este correo.\n\n` +
        `Omega Veterinaria & Estética`,
      attachments: archivos.map((a) => ({ filename: a.nombreOriginal, path: a.rutaAbsoluta })),
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
async function enviarPorWhatsapp({ telefono, nombreTutor, nombreMascota, archivos }) {
  try {
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
