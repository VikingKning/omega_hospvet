// Sanitización de texto de entrada (reporte de seguridad M-07): defensa en
// profundidad contra XSS almacenado. EJS ya escapa todo lo que se renderiza
// con `<%= %>` (el patrón usado en TODO el proyecto, nunca `<%- %>` para
// datos de usuario), así que un `<script>` guardado tal cual en la BD no se
// ejecuta hoy — pero viaja crudo a cualquier contexto FUTURO que no escape
// (un PDF, un correo, una plantilla de WhatsApp, un nuevo reporte). Esta
// pieza vive en config/ (no en un módulo de negocio) por el mismo motivo que
// passwordPolicy.js: tiene que ser BYTE-IDÉNTICA en cualquier endpoint de
// escritura que la use — duplicarla arriesgaría que una copia quede
// desactualizada y abra un hueco real, algo que la independencia entre
// módulos normalmente no arriesga porque cada copia ahí es intencionalmente
// distinta a nivel de negocio.
const sanitizeHtml = require('sanitize-html');

// Solo texto plano: ninguna etiqueta/atributo de este sistema necesita
// sobrevivir (nombres, direcciones, motivos, observaciones — todo se
// muestra como texto simple). `disallowedTagsMode: 'discard'` además del
// default ya vacío: cualquier <script>/<style> se descarta CON su
// contenido, nunca lo deja como texto suelto.
const OPCIONES_SANITIZE_HTML = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

// sanitize-html, al quitar las etiquetas reales, vuelve a *codificar* como
// entidad cualquier &/</>/"/' que quede en el texto plano restante (es una
// librería pensada para producir HTML seguro de insertar, no texto de
// negocio) — sin este segundo paso, "García & Asociados" se guardaría en la
// BD como "García &amp; Asociados" para siempre, y ese mismo dato mostrado
// por WhatsApp/correo (que no interpretan HTML) se vería mal. Es seguro
// decodificar estas 5 entidades DESPUÉS de sanitizar: para este punto ya no
// queda ninguna etiqueta real en el resultado (sanitize-html ya la quitó en
// el paso anterior), así que recuperar "<"/">" como caracteres sueltos no
// puede reconstruir una etiqueta que no estuviera ya descartada.
const ENTIDADES_A_DECODIFICAR = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function sanitizarTexto(valor) {
  const limpio = sanitizeHtml(String(valor ?? ''), OPCIONES_SANITIZE_HTML);
  return limpio.replace(
    /&amp;|&lt;|&gt;|&quot;|&#39;/g,
    (entidad) => ENTIDADES_A_DECODIFICAR[entidad],
  );
}

module.exports = { sanitizarTexto };
