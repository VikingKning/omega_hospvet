const nodemailer = require('nodemailer');
const env = require('./env');

function isEmailConfigured() {
  const { host, user, password } = env.email;
  return Boolean(host && user && password);
}

let cachedTransporter = null;

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
