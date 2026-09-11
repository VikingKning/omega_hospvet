const { sanitizarTexto } = require('../config/sanitizarTexto');

// Reporte de seguridad M-07: en vez de acordarse de aplicar sanitizarTexto()
// en cada endpoint de escritura de cada módulo (garantizado a fallar tarde
// o temprano — bastaría con OLVIDAR uno solo), se aplica una vez aquí, sobre
// req.body, para TODAS las rutas. Nunca sobre req.query: los filtros de
// tabla son de solo lectura, no se guardan en la BD, y el propio valor ya
// sale escapado por EJS al reflejarse en el input del buscador.
//
// Campos con contraseña en texto plano quedan exentos a propósito — nunca
// deben pasar por una transformación que no sea EXACTAMENTE la que compara
// bcrypt (sanitizarTexto podría alterar un símbolo legítimo de la
// contraseña, ej. `<` o `&`, causando que un login/cambio de contraseña
// válido falle de forma silenciosa e intermitente).
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
