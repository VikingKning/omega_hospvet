const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const config = require('../../config/env');

const STORAGE_ROOT = config.labsResultFileStorage;

const TIPOS_PERMITIDOS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const TIPOS_FUSIONABLES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const LIBREOFFICE_TIMEOUT_MS = 60_000;

async function convertirWordAPdf(buffer, nombreOriginal) {
  const extension = path.extname(nombreOriginal).toLowerCase() || '.docx';
  const carpetaTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-lab-word-'));
  const rutaEntrada = path.join(carpetaTemp, `documento${extension}`);
  const rutaPerfil = path.join(carpetaTemp, 'perfil');

  try {
    await fs.writeFile(rutaEntrada, buffer);
    await new Promise((resolve, reject) => {
      execFile(
        'soffice',
        [
          '--headless',
          '--norestore',
          `-env:UserInstallation=file://${rutaPerfil}`,
          '--convert-to',
          'pdf:writer_pdf_Export',
          '--outdir',
          carpetaTemp,
          rutaEntrada,
        ],
        { timeout: LIBREOFFICE_TIMEOUT_MS },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return await fs.readFile(path.join(carpetaTemp, 'documento.pdf'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'LibreOffice no está instalado en el servidor — no se puede convertir documentos de Word a PDF.',
        { cause: err },
      );
    }
    throw new ArchivoValidationError(
      `No se pudo convertir "${nombreOriginal}" a PDF. Verifica que el documento no esté dañado.`,
      { cause: err },
    );
  } finally {
    await fs.rm(carpetaTemp, { recursive: true, force: true }).catch(() => {});
  }
}

const TIPOS_WORD = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MIME_POR_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function mimetypeDeArchivo(nombreOriginal) {
  return (
    MIME_POR_EXTENSION[path.extname(nombreOriginal).toLowerCase()] ?? 'application/octet-stream'
  );
}

class ArchivoValidationError extends Error {
  constructor(message, options) {
    super(message, options);
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
        `"${noFusionable.originalname}" no se puede combinar con otros archivos en un solo PDF (solo JPG, PNG, PDF, DOC o DOCX) — sube ese archivo solo.`,
      );
    }
  }
}

async function fusionarEnPdf(files) {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const esWord = TIPOS_WORD.has(file.mimetype);
    const bufferPdfOrigen = esWord
      ? await convertirWordAPdf(file.buffer, file.originalname)
      : file.buffer;

    const bytes = new Uint8Array(bufferPdfOrigen);
    if (esWord || file.mimetype === 'application/pdf') {
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

async function eliminarFisico(rutaAlmacenamiento) {
  await fs.unlink(rutaAbsolutaDeArchivo(rutaAlmacenamiento)).catch(() => {});
}

module.exports = {
  ArchivoValidationError,
  calcularHash,
  procesarArchivos,
  rutaAbsolutaDeArchivo,
  mimetypeDeArchivo,
  eliminarFisico,
};
