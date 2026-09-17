const Joi = require('joi');

const loginSchema = Joi.object({
  username: Joi.string().trim().min(1).required(),
  password: Joi.string().min(1).required(),
});

const cambiarPasswordSchema = Joi.object({
  password: Joi.string().min(1).required(),
  confirmacion: Joi.string().min(1).required(),
});

module.exports = { loginSchema, cambiarPasswordSchema };
