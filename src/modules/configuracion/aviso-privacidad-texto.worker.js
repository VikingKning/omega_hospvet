const { parentPort, workerData } = require('worker_threads');
const { PDFParse } = require('pdf-parse');
const { extraerContenidoDesdeParser } = require('./aviso-privacidad-pdf-layout');

async function ejecutar() {
  let parser = new PDFParse({ data: new Uint8Array(workerData), isEvalSupported: false });
  try {
    let resultado;
    try {
      resultado = await extraerContenidoDesdeParser(parser);
    } catch {
      // Algunos PDFs (y el VM aislado de Jest) permiten extraer el texto,
      // pero no exponen todos los operadores necesarios para reconstruir el
      // formato. En ese caso se conserva una presentación legible en vez de
      // declarar erróneamente que el documento no contiene texto.
      await parser.destroy().catch(() => {});
      parser = new PDFParse({ data: new Uint8Array(workerData), isEvalSupported: false });
      const resultadoPlano = await parser.getText();
      resultado = {
        texto: resultadoPlano.text,
        bloques: resultadoPlano.text
          .split(/\n{2,}/)
          .map((texto) => texto.trim())
          .filter(Boolean)
          .map((texto) => ({
            tipo: 'parrafo',
            runs: [{ texto, negrita: false, cursiva: false }],
          })),
      };
    }
    await parser.destroy();
    parentPort.postMessage(resultado);
  } catch (error) {
    try {
      await parser.destroy();
    } catch {
      // La extracción ya falló; se conserva el error original.
    }
    parentPort.postMessage({ error: error.message || 'No fue posible procesar el PDF.' });
  } finally {
    parentPort.close();
  }
}

void ejecutar();
