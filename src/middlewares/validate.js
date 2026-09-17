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
