const path = require('path');
const { Worker } = require('worker_threads');
const { extraerContenidoDesdeParser } = require('./aviso-privacidad-pdf-layout');

const TIEMPO_MAXIMO_EXTRACCION_MS = 15000;
const WORKER_PATH = path.join(__dirname, 'aviso-privacidad-texto.worker.js');

function normalizarTexto(texto) {
  return String(texto || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linea) => linea.replace(/[\t ]+/g, ' ').trim())
    .filter((linea) => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(linea))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extraerTextoConWorker(buffer) {
  return new Promise((resolve, reject) => {
    // pdf-parse usa módulos ESM internamente. Ejecutarlo en un worker real
    // mantiene esa dependencia aislada del proceso web y también del VM de
    // Jest, además de permitir cortar un PDF que tarde demasiado en parsear.
    const worker = new Worker(WORKER_PATH, {
      workerData: Uint8Array.from(buffer),
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let finalizado = false;
    const terminar = (callback) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(temporizador);
      worker.removeAllListeners();
      void worker.terminate();
      callback();
    };
    const temporizador = setTimeout(() => {
      terminar(() => reject(new Error('La extracción de texto excedió el tiempo permitido.')));
    }, TIEMPO_MAXIMO_EXTRACCION_MS);

    worker.once('message', (resultado) => {
      if (resultado.error) {
        terminar(() => reject(new Error(resultado.error)));
        return;
      }
      terminar(() => resolve(resultado));
    });
    worker.once('error', (error) => terminar(() => reject(error)));
    worker.once('exit', (codigo) => {
      if (codigo !== 0) {
        terminar(() => reject(new Error(`El lector de PDF terminó con código ${codigo}.`)));
      }
    });
  });
}

async function extraerContenidoDirectamente(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });

  try {
    return await extraerContenidoDesdeParser(parser);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extraerDocumentoPdf(buffer) {
  let resultado;
  try {
    resultado = await extraerTextoConWorker(buffer);
  } catch (errorWorker) {
    // En algunos procesos administrados (por ejemplo, node --watch o un
    // wrapper de servicio) el Worker puede fallar al iniciar aun cuando el
    // PDF sea válido. La extracción directa evita mostrar un falso error en
    // la página pública; el Worker continúa siendo la ruta principal para
    // aislar PDFs costosos o dañados.
    try {
      resultado = await extraerContenidoDirectamente(buffer);
    } catch (errorDirecto) {
      errorDirecto.cause = errorWorker;
      throw errorDirecto;
    }
  }

  // Un Worker que termina sin error pero no obtiene texto también puede ser
  // un falso negativo del entorno. Se confirma una vez en el proceso web
  // antes de declarar que el PDF no tiene contenido seleccionable.
  if (!normalizarTexto(resultado?.texto)) {
    resultado = await extraerContenidoDirectamente(buffer);
  }

  return {
    texto: normalizarTexto(resultado.texto),
    bloques: resultado.bloques || [],
  };
}

async function extraerTextoPdf(buffer) {
  return (await extraerDocumentoPdf(buffer)).texto;
}

function separarEnBloques(texto) {
  return normalizarTexto(texto)
    .split(/\n{2,}/)
    .map((bloque) => bloque.trim())
    .filter(Boolean);
}

module.exports = {
  extraerDocumentoPdf,
  extraerTextoPdf,
  separarEnBloques,
};
