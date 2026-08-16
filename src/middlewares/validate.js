// Envoltura genérica de esquemas Joi por ruta (documento de Arquitectura y
// Buenas Prácticas, sección 4.2): ningún controller revisa a mano si un
// campo llegó vacío, eso vive aquí. `errorMessage` es opcional (default:
// el mensaje original de loginSchema, única ruta que usaba esto hasta
// US-605) — cada ruta que valide un esquema distinto manda el suyo propio,
// en vez de heredar un mensaje que hable de "usuario y contraseña" para un
// formulario que no tiene esos campos.
function validate(schema, errorMessage = 'Usuario y contraseña son obligatorios.') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({ error: errorMessage });
    }

    req.body = value;
    next();
  };
}

module.exports = validate;
