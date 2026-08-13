// Envoltura genérica de esquemas Joi por ruta (documento de Arquitectura y
// Buenas Prácticas, sección 4.2): ningún controller revisa a mano si un
// campo llegó vacío, eso vive aquí.
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }

    req.body = value;
    next();
  };
}

module.exports = validate;
