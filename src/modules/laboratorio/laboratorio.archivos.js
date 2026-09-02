// Carga de archivos de resultados (pedido explícito del usuario) — capa
// aparte del repository/service porque habla con el sistema de archivos y
// con pdf-lib, no con la base de datos. Guarda SIEMPRE fuera de `public/`
// (ver comentario del .gitignore): express.static sirve public/ entero sin
// autenticación, y estos son resultados médicos de pacientes — se sirven
// por una ruta propia autenticada (laboratorio.controller.js#descargarArchivo),
// nunca por static serving directo.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const config = require('../../config/env');

// Pedido explícito del usuario: la ruta ya NO vive fija dentro del proyecto,
// cada entorno la declara en su .env (LABS_RESULT_FILE_STORAGE) — puede
// apuntar a cualquier carpeta del sistema, dentro o fuera del repo.
const STORAGE_ROOT = config.labsResultFileStorage;

// video/foto/PDF (pedido explícito del usuario) — mp4/mov/webm cubren los
// formatos de video reales que entrega un teléfono o una cámara de
// consultorio; jpeg/png/webp los de foto.
const TIPOS_PERMITIDOS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

// pdf-lib solo puede EMBEBER jpeg/png de verdad (webp no tiene soporte
// nativo en la librería, y un video no se puede convertir a página de
// PDF) — un webp o un video siguen siendo válidos como archivo ÚNICO
// (se guardan tal cual, sin fusionar), pero no pueden combinarse con
// otros archivos en el mismo lote.
const TIPOS_FUSIONABLES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

class ArchivoValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function validarArchivos(files) {
  if (!files || files.length === 0) {
    throw new ArchivoValidationError('Selecciona al menos un archivo.');
  }
  for (const file of files) {
    if (!TIPOS_PERMITIDOS.has(file.mimetype)) {
      throw new ArchivoValidationError(`Tipo de archivo no permitido: "${file.originalname}".`);
    }
  }
  if (files.length > 1) {
    const noFusionable = files.find((file) => !TIPOS_FUSIONABLES.has(file.mimetype));
    if (noFusionable) {
      throw new ArchivoValidationError(
        `"${noFusionable.originalname}" no se puede combinar con otros archivos en un solo PDF (solo JPG, PNG o PDF) — sube ese archivo solo.`,
      );
    }
  }
}

async function fusionarEnPdf(files) {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    // new Uint8Array(...) a propósito, no file.buffer tal cual: pdf-lib
    // espera un Uint8Array "puro" — un Buffer de Node lo ES (hereda de
    // Uint8Array), pero un `instanceof` de otra realm/VM lo puede rechazar
    // (confirmado en vivo: fallaba con "SOI not found" dentro de Jest,
    // nunca en Node normal, con los mismos bytes) — este wrap es inocuo en
    // producción y evita ese caso raro en cualquier entorno.
    const bytes = new Uint8Array(file.buffer);
    if (file.mimetype === 'application/pdf') {
      const origen = await PDFDocument.load(bytes);
      const paginas = await pdf.copyPages(origen, origen.getPageIndices());
      paginas.forEach((pagina) => pdf.addPage(pagina));
    } else {
      const imagen =
        file.mimetype === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const pagina = pdf.addPage([imagen.width, imagen.height]);
      pagina.drawImage(imagen, { x: 0, y: 0, width: imagen.width, height: imagen.height });
    }
  }
  return Buffer.from(await pdf.save());
}

// US-409: SHA-256 del contenido binario tal cual (nunca del nombre/ruta/
// fecha) — exportada para poder calcularse ANTES de fusionar (laboratorio.
// service.js#validarArchivosNoDuplicados la usa sobre cada archivo crudo
// del lote, antes de que exista el PDF consolidado) y reutilizada aquí
// para el hash del contenido final ya guardado (crudo si es 1 solo
// archivo, del PDF fusionado si son 2+) — mismo algoritmo, dos momentos
// distintos del mismo flujo.
function calcularHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function guardarEnDisco({ registroId, buffer, nombreOriginal, consolidado }) {
  const hashContenido = calcularHash(buffer);
  const carpeta = path.join(STORAGE_ROOT, String(registroId));
  await fs.mkdir(carpeta, { recursive: true });
  const extension = consolidado ? '.pdf' : path.extname(nombreOriginal);
  const nombreArchivo = `${crypto.randomUUID()}${extension}`;
  const rutaAbsoluta = path.join(carpeta, nombreArchivo);
  await fs.writeFile(rutaAbsoluta, buffer);

  return {
    nombreOriginal,
    rutaAlmacenamiento: path.join(String(registroId), nombreArchivo),
    hashContenido,
    tamanoBytes: buffer.length,
    consolidado,
  };
}

// Punto de entrada: 1 archivo se guarda tal cual (imagen/video/PDF, sin
// convertir); 2+ se fusionan en un solo PDF nuevo (pedido explícito del
// usuario — "esas 5 imágenes se deberían de almacenar en uno solo").
async function procesarArchivos({ registroId, files }) {
  validarArchivos(files);

  if (files.length === 1) {
    const [file] = files;
    return guardarEnDisco({
      registroId,
      buffer: file.buffer,
      nombreOriginal: file.originalname,
      consolidado: false,
    });
  }

  const buffer = await fusionarEnPdf(files);
  return guardarEnDisco({
    registroId,
    buffer,
    nombreOriginal: `Resultados combinados (${files.length} archivos).pdf`,
    consolidado: true,
  });
}

function rutaAbsolutaDeArchivo(rutaAlmacenamiento) {
  return path.join(STORAGE_ROOT, rutaAlmacenamiento);
}

// US-409 v2: limpieza de mejor esfuerzo cuando `procesarArchivos` ya
// escribió el binario a disco pero el paso siguiente (crear la fila en
// `archivos_laboratorio`) truena — por ejemplo, la carrera real que cierra
// el índice único parcial sobre hash_contenido. Nunca debe tapar el error
// real que se está propagando, por eso traga cualquier fallo del propio
// unlink (archivo ya borrado, permisos, lo que sea).
async function eliminarFisico(rutaAlmacenamiento) {
  await fs.unlink(rutaAbsolutaDeArchivo(rutaAlmacenamiento)).catch(() => {});
}

module.exports = {
  ArchivoValidationError,
  calcularHash,
  procesarArchivos,
  rutaAbsolutaDeArchivo,
  eliminarFisico,
};
