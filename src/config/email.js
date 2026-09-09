// Cliente SMTP (envío de resultados de laboratorio por correo) — Nodemailer,
// mismo criterio de aislamiento que googleCalendar.js/whatsapp.js
// (isEmailConfigured(), opcional: sin las variables, la app sigue
// funcionando normal, el envío por correo simplemente no se activa).
const nodemailer = require('nodemailer');
const env = require('./env');

function isEmailConfigured() {
  const { host, user, password } = env.email;
  return Boolean(host && user && password);
}

let cachedTransporter = null;

// Un solo transporter reutilizado entre llamadas (mismo criterio que `db`
// en database.js / cachedClient en googleCalendar.js).
function getTransporter() {
  if (!isEmailConfigured()) {
    throw new Error('El envío de correo no está configurado (faltan variables de entorno).');
  }
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.secure,
    auth: { user: env.email.user, pass: env.email.password },
  });
  return cachedTransporter;
}

module.exports = { isEmailConfigured, getTransporter };
