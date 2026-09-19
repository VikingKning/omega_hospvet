const crypto = require('crypto');

const MARCADORES = {
  correo: '[correo]',
  telefono: '[telefono]',
  folio: '[folio]',
  identificador: '[identificador]',
  nombre: '[nombre]',
  enlace: '[enlace]',
};

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_REGEX = /https?:\/\/[^\s]+/gi;
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const RFC_REGEX = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi;
const FOLIO_REGEX =
  /\b(?:folio|orden|lab|id|identificaci[oó]n|c[eé]dula|expediente|referencia)\s*[:#-]?\s*[a-z0-9-]*\d[a-z0-9-]*\b/gi;
const TELEFONO_REGEX = /(?<![\w])(?:\+?\d[\s().-]*){10,15}(?![\w])/g;
const IDENTIFICADOR_LARGO_REGEX = /\b(?=[a-z0-9_-]{16,}\b)(?=[a-z0-9_-]*\d)[a-z0-9_-]+\b/gi;

function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function variantesNombre(nombresConocidos = []) {
  return [
    ...new Set(
      nombresConocidos
        .flatMap((nombre) =>
          String(nombre ?? '')
            .trim()
            .split(/\s+/),
        )
        .filter((parte) => parte.length >= 3),
    ),
  ].sort((a, b) => b.length - a.length);
}

function minimizarTextoParaClaude(texto, { nombresConocidos = [], maximoCaracteres = 2000 } = {}) {
  let limpio = String(texto ?? '')
    .replace(URL_REGEX, MARCADORES.enlace)
    .replace(EMAIL_REGEX, MARCADORES.correo)
    .replace(UUID_REGEX, MARCADORES.identificador)
    .replace(RFC_REGEX, MARCADORES.identificador)
    .replace(FOLIO_REGEX, MARCADORES.folio)
    .replace(TELEFONO_REGEX, MARCADORES.telefono)
    .replace(IDENTIFICADOR_LARGO_REGEX, MARCADORES.identificador);

  for (const nombre of variantesNombre(nombresConocidos)) {
    limpio = limpio.replace(
      new RegExp(`(^|[^\\p{L}])${escaparRegex(nombre)}(?=$|[^\\p{L}])`, 'giu'),
      `$1${MARCADORES.nombre}`,
    );
  }

  limpio = limpio.replace(/\s+/g, ' ').trim();
  return limpio.slice(0, maximoCaracteres);
}

function referenciaPrivada(valor, prefijo = 'ref') {
  const secreto = process.env.SESSION_SECRET || 'omega-log-reference';
  const digest = crypto
    .createHmac('sha256', secreto)
    .update(String(valor ?? ''))
    .digest('hex')
    .slice(0, 12);
  return `${prefijo}_${digest}`;
}

function enmascararTelefono(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  return `******${digitos.slice(-4)}`;
}

function enmascararCorreo(valor) {
  const correo = String(valor ?? '').trim();
  const indiceArroba = correo.indexOf('@');
  if (indiceArroba <= 0) return null;
  const local = correo.slice(0, indiceArroba);
  const dominio = correo.slice(indiceArroba + 1);
  const localVisible = local.slice(0, Math.min(2, local.length));
  const partesDominio = dominio.split('.');
  const nombreDominio = partesDominio.shift() || '';
  const sufijo = partesDominio.length ? `.${partesDominio.join('.')}` : '';
  return `${localVisible}${'*'.repeat(Math.max(3, local.length - localVisible.length))}@${nombreDominio.slice(0, 1)}***${sufijo}`;
}

function sanitizarTextoLog(texto) {
  return String(texto ?? '')
    .replace(URL_REGEX, '[ENLACE]')
    .replace(EMAIL_REGEX, (correo) => `[EMAIL:${referenciaPrivada(correo, 'email')}]`)
    .replace(TELEFONO_REGEX, (telefono) => `[TEL:${referenciaPrivada(telefono, 'tel')}]`)
    .replace(/(?:bearer\s+)[a-z0-9._~+/-]+/gi, 'Bearer [REDACTADO]')
    .replace(/\b(?:sk-ant-|GOCSPX-|EAA)[a-z0-9_-]+\b/gi, '[CREDENCIAL]')
    .slice(0, 1000);
}

const CLAVE_SECRETA =
  /(password|contrasena|contraseña|secret|token|authorization|cookie|payload|rawbody|mensaje_recibido|texto_consolidado|resultado_clinico|archivo|contenido|^data$|^response$|^request$|^err$|^error$|ultimo_error|error_tecnico)/i;
const CLAVE_TELEFONO = /(telefono|phone|wa_id|destinatario_telefono)/i;
const CLAVE_CORREO = /(correo|email|destinatario_correo)/i;
const CLAVE_NOMBRE =
  /^(nombre|nombre_tutor|nombre_mascota|propietario_nombre|propietario_apellidos)$/i;

function sanitizarParaLog(valor, clave = '', vistos = new WeakSet()) {
  if (valor === null || valor === undefined) return valor;
  if (valor instanceof Error) {
    return {
      type: valor.name,
      code: valor.code ?? null,
      status: valor.status ?? valor.statusCode ?? null,
    };
  }
  if (CLAVE_TELEFONO.test(clave)) return referenciaPrivada(valor, 'tel');
  if (CLAVE_CORREO.test(clave)) return referenciaPrivada(valor, 'email');
  if (CLAVE_NOMBRE.test(clave)) return '[DATO_PERSONAL]';
  if (CLAVE_SECRETA.test(clave)) return '[REDACTADO]';
  if (typeof valor === 'string') return sanitizarTextoLog(valor);
  if (typeof valor !== 'object') return valor;
  if (Buffer.isBuffer(valor)) return `[BUFFER:${valor.length}]`;
  if (vistos.has(valor)) return '[CIRCULAR]';
  vistos.add(valor);

  if (Array.isArray(valor)) return valor.map((item) => sanitizarParaLog(item, clave, vistos));
  return Object.fromEntries(
    Object.entries(valor).map(([key, item]) => [key, sanitizarParaLog(item, key, vistos)]),
  );
}

module.exports = {
  minimizarTextoParaClaude,
  referenciaPrivada,
  enmascararTelefono,
  enmascararCorreo,
  sanitizarTextoLog,
  sanitizarParaLog,
};
