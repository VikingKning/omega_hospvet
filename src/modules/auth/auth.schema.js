const Joi = require('joi');

// El cliente ya exige ambos campos (AC1 de US-101), pero nunca se confía en
// esa validación como única barrera: se repite aquí en el servidor.
const loginSchema = Joi.object({
  username: Joi.string().trim().min(1).required(),
  password: Joi.string().min(1).required(),
});

module.exports = { loginSchema };
