const sanitizeHtml = require('sanitize-html');

const OPCIONES_SANITIZE_HTML = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

const ENTIDADES_A_DECODIFICAR = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function sanitizarTexto(valor) {
  const limpio = sanitizeHtml(String(valor ?? ''), OPCIONES_SANITIZE_HTML);
  // Las vistas vuelven a escapar este texto con EJS; aquí solo normalizamos entidades.
  return limpio.replace(
    /&amp;|&lt;|&gt;|&quot;|&#39;/g,
    (entidad) => ENTIDADES_A_DECODIFICAR[entidad],
  );
}

module.exports = { sanitizarTexto };
