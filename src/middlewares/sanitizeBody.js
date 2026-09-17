const { sanitizarTexto } = require('../config/sanitizarTexto');

const CAMPOS_EXENTOS = new Set(['password', 'confirmacion', 'passwordActual', 'passwordNueva']);

function sanitizarValor(valor, clave) {
  if (CAMPOS_EXENTOS.has(clave)) return valor;
  if (typeof valor === 'string') return sanitizarTexto(valor);
  if (Array.isArray(valor)) return valor.map((item) => sanitizarValor(item, clave));
  if (valor && typeof valor === 'object') return sanitizarObjeto(valor);
  return valor;
}

function sanitizarObjeto(objeto) {
  const resultado = {};
  for (const [clave, valor] of Object.entries(objeto)) {
    resultado[clave] = sanitizarValor(valor, clave);
  }
  return resultado;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizarObjeto(req.body);
  }
  next();
}

module.exports = sanitizeBody;
