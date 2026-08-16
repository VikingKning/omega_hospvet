const Joi = require('joi');

// El cliente ya exige ambos campos (AC1 de US-101), pero nunca se confía en
// esa validación como única barrera: se repite aquí en el servidor.
const loginSchema = Joi.object({
  username: Joi.string().trim().min(1).required(),
  password: Joi.string().min(1).required(),
});

// US-605: solo valida presencia — la política real (mínimo 8 caracteres,
// coincide con confirmación) vive en auth.service.js#cambiarPasswordObligatorio,
// mismo criterio que loginSchema/PASSWORD_MIN_LENGTH de usuarios.service.js.
const cambiarPasswordSchema = Joi.object({
  password: Joi.string().min(1).required(),
  confirmacion: Joi.string().min(1).required(),
});

module.exports = { loginSchema, cambiarPasswordSchema };
