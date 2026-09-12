// laboratorio.archivos.js: fusiona varios archivos en un solo PDF (pedido
// explícito del usuario) o guarda uno solo tal cual — sin tocar la base de
// datos (eso vive en laboratorio.repository.js). `fs/promises` mockeado
// para no escribir a disco de verdad en un test unitario; el Buffer que se
// le pasa a writeFile sí es un PDF/imagen real (generado con pdf-lib), así
// que se puede releer con PDFDocument.load() para verificar el resultado.
// `child_process` mockeado porque combinar doc/docx invoca LibreOffice de
// verdad (convertirWordAPdf) — nunca se corre soffice en un test unitario;
// el mock simula una conversión exitosa y fs.readFile (también mockeado)
// entrega el PDF "convertido" como si LibreOffice ya lo hubiera escrito en
// el directorio temporal.
jest.mock('fs/promises');
jest.mock('child_process');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const crypto = require('crypto');
const {
  ArchivoValidationError,
  calcularHash,
  procesarArchivos,
  rutaAbsolutaDeArchivo,
  eliminarFisico,
} = require('../../src/modules/laboratorio/laboratorio.archivos');

// Fixtures mínimas reales (1x1 px) — pdf-lib parsea de verdad los bytes al
// embeber, un Buffer falso truena con "SOI not found"/similar.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const JPG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKp//9k=',
  'base64',
);

async function pdfConPaginas(n) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) pdf.addPage([100, 100]);
  return Buffer.from(await pdf.save());
}

function archivo(nombre, mimetype, buffer) {
  return { originalname: nombre, mimetype, buffer };
}

describe('laboratorio.archivos.procesarArchivos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    // Mocks de convertirWordAPdf (solo se ejercitan en los tests que
    // combinan un doc/docx con algo más — un docx solo nunca llama a
    // fusionarEnPdf, ver "un solo .docx se guarda tal cual" más abajo).
    fs.mkdtemp.mockResolvedValue('/tmp/omega-lab-word-fake');
    fs.rm.mockResolvedValue(undefined);
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null));
  });

  it('rechaza una lista vacía', async () => {
    await expect(procesarArchivos({ registroId: 7, files: [] })).rejects.toThrow(
      'Selecciona al menos un archivo.',
    );
  });

  it('rechaza un tipo de archivo no permitido', async () => {
    await expect(
      procesarArchivos({
        registroId: 7,
        files: [archivo('virus.exe', 'application/x-msdownload', Buffer.from('x'))],
      }),
    ).rejects.toThrow(ArchivoValidationError);
  });

  it('un solo archivo se guarda tal cual, sin fusionar (consolidado=false)', async () => {
    const resultado = await procesarArchivos({
      registroId: 7,
      files: [archivo('radiografia.jpg', 'image/jpeg', JPG_1PX)],
    });

    expect(resultado.consolidado).toBe(false);
    expect(resultado.nombreOriginal).toBe('radiografia.jpg');
    expect(resultado.tamanoBytes).toBe(JPG_1PX.length);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const bufferGuardado = fs.writeFile.mock.calls[0][1];
    expect(Buffer.compare(bufferGuardado, JPG_1PX)).toBe(0);
  });

  it('un solo video se guarda tal cual (no se convierte a PDF)', async () => {
    const videoBuffer = Buffer.from('contenido-de-video-falso');
    const resultado = await procesarArchivos({
      registroId: 7,
      files: [archivo('endoscopia.mp4', 'video/mp4', videoBuffer)],
    });

    expect(resultado.consolidado).toBe(false);
    expect(resultado.nombreOriginal).toBe('endoscopia.mp4');
  });

  it('varias imágenes se fusionan en un solo PDF con una página por imagen (pedido explícito del usuario)', async () => {
    const resultado = await procesarArchivos({
      registroId: 7,
      files: [
        archivo('rx1.jpg', 'image/jpeg', JPG_1PX),
        archivo('rx2.png', 'image/png', PNG_1PX),
        archivo('rx3.jpg', 'image/jpeg', JPG_1PX),
      ],
    });

    expect(resultado.consolidado).toBe(true);
    expect(resultado.nombreOriginal).toBe('Resultados combinados (3 archivos).pdf');

    const bufferGuardado = fs.writeFile.mock.calls[0][1];
    const pdfResultante = await PDFDocument.load(bufferGuardado);
    expect(pdfResultante.getPageCount()).toBe(3);
  });

  it('un PDF ya existente + una imagen se fusionan conservando TODAS las páginas del PDF original', async () => {
    const pdfDeDosPaginas = await pdfConPaginas(2);
    const resultado = await procesarArchivos({
      registroId: 7,
      files: [
        archivo('previo.pdf', 'application/pdf', pdfDeDosPaginas),
        archivo('extra.jpg', 'image/jpeg', JPG_1PX),
      ],
    });

    expect(resultado.consolidado).toBe(true);
    const bufferGuardado = fs.writeFile.mock.calls[0][1];
    const pdfResultante = await PDFDocument.load(bufferGuardado);
    expect(pdfResultante.getPageCount()).toBe(3);
  });

  it('rechaza combinar un video con otro archivo en el mismo lote — no se puede convertir a PDF', async () => {
    await expect(
      procesarArchivos({
        registroId: 7,
        files: [
          archivo('video.mp4', 'video/mp4', Buffer.from('x')),
          archivo('foto.jpg', 'image/jpeg', JPG_1PX),
        ],
      }),
    ).rejects.toThrow(/no se puede combinar/);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('rechaza combinar un webp con otro archivo (pdf-lib no lo puede embeber)', async () => {
    await expect(
      procesarArchivos({
        registroId: 7,
        files: [
          archivo('foto.webp', 'image/webp', Buffer.from('x')),
          archivo('foto2.jpg', 'image/jpeg', JPG_1PX),
        ],
      }),
    ).rejects.toThrow(/no se puede combinar/);
  });

  it('un solo .docx se guarda tal cual (no se convierte a PDF)', async () => {
    const docxBuffer = Buffer.from('contenido-de-word-falso');
    const resultado = await procesarArchivos({
      registroId: 7,
      files: [
        archivo(
          'resultados.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          docxBuffer,
        ),
      ],
    });

    expect(resultado.consolidado).toBe(false);
    expect(resultado.nombreOriginal).toBe('resultados.docx');
  });

  it('un solo .doc (formato viejo de Word) también se acepta', async () => {
    const resultado = await procesarArchivos({
      registroId: 7,
      files: [archivo('resultados.doc', 'application/msword', Buffer.from('x'))],
    });

    expect(resultado.consolidado).toBe(false);
  });

  it('un .docx SÍ se puede combinar con otro archivo — se convierte a PDF con LibreOffice antes de fusionar', async () => {
    const pdfConvertido = await pdfConPaginas(1);
    fs.readFile.mockResolvedValue(pdfConvertido);

    const resultado = await procesarArchivos({
      registroId: 7,
      files: [
        archivo(
          'resultados.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          Buffer.from('contenido-de-word-falso'),
        ),
        archivo('foto.jpg', 'image/jpeg', JPG_1PX),
      ],
    });

    expect(resultado.consolidado).toBe(true);
    // 1 página del docx "convertido" + 1 página nueva por la imagen.
    const bufferGuardado = fs.writeFile.mock.calls.at(-1)[1];
    const pdfResultante = await PDFDocument.load(bufferGuardado);
    expect(pdfResultante.getPageCount()).toBe(2);

    // La conversión corre con un perfil de LibreOffice AISLADO por
    // invocación (para poder correr varias en paralelo sin bloquearse) —
    // ver convertirWordAPdf.
    const [, argumentos] = execFile.mock.calls[0];
    expect(argumentos).toEqual(
      expect.arrayContaining([expect.stringMatching(/^-env:UserInstallation=file:\/\//)]),
    );
  });

  it('un .doc (formato viejo) también se puede combinar, mismo mecanismo de conversión', async () => {
    fs.readFile.mockResolvedValue(await pdfConPaginas(2));

    const resultado = await procesarArchivos({
      registroId: 7,
      files: [
        archivo('resultados.doc', 'application/msword', Buffer.from('x')),
        archivo('rx.png', 'image/png', PNG_1PX),
      ],
    });

    expect(resultado.consolidado).toBe(true);
    const bufferGuardado = fs.writeFile.mock.calls.at(-1)[1];
    const pdfResultante = await PDFDocument.load(bufferGuardado);
    expect(pdfResultante.getPageCount()).toBe(3);
  });

  it('si LibreOffice no está instalado en el servidor, lanza un error normal (no de validación)', async () => {
    const errorSinBinario = new Error('spawn soffice ENOENT');
    errorSinBinario.code = 'ENOENT';
    execFile.mockImplementation((cmd, args, opts, cb) => cb(errorSinBinario));

    await expect(
      procesarArchivos({
        registroId: 7,
        files: [
          archivo('resultados.docx', 'application/msword', Buffer.from('x')),
          archivo('foto.jpg', 'image/jpeg', JPG_1PX),
        ],
      }),
    ).rejects.not.toBeInstanceOf(ArchivoValidationError);
  });

  it('si LibreOffice falla al convertir un documento (dañado/corrupto), lanza ArchivoValidationError', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('conversion failed')));

    await expect(
      procesarArchivos({
        registroId: 7,
        files: [
          archivo('resultados.docx', 'application/msword', Buffer.from('x')),
          archivo('foto.jpg', 'image/jpeg', JPG_1PX),
        ],
      }),
    ).rejects.toThrow(ArchivoValidationError);
  });

  it('crea la carpeta del registro antes de escribir', async () => {
    await procesarArchivos({ registroId: 42, files: [archivo('a.jpg', 'image/jpeg', JPG_1PX)] });
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining(`${require('path').sep}42`), {
      recursive: true,
    });
  });
});

describe('laboratorio.archivos.rutaAbsolutaDeArchivo', () => {
  it('resuelve la ruta relativa guardada contra la raíz de almacenamiento', () => {
    const ruta = rutaAbsolutaDeArchivo('7/abc.pdf');
    expect(ruta.endsWith(require('path').join('storage', 'laboratorio', '7', 'abc.pdf'))).toBe(
      true,
    );
  });
});

// US-409: exportada para que laboratorio.service.js pueda calcularla sobre
// cada archivo CRUDO del lote, antes de fusionar (ver
// laboratorio.service.js#resolverConflictoDeHashes) — se valida aquí que
// sea SHA-256 real (sensible al contenido, no al nombre/tamaño) y
// determinista, sin depender de ningún mock de fs.
describe('laboratorio.archivos.calcularHash', () => {
  it('calcula el SHA-256 real del contenido (mismo resultado que crypto directo)', () => {
    const esperado = crypto.createHash('sha256').update(PNG_1PX).digest('hex');
    expect(calcularHash(PNG_1PX)).toBe(esperado);
  });

  it('es determinista: el mismo contenido siempre da el mismo hash', () => {
    expect(calcularHash(PNG_1PX)).toBe(calcularHash(Buffer.from(PNG_1PX)));
  });

  it('contenido distinto da hashes distintos, sin importar el nombre', () => {
    const otro = Buffer.from('contenido completamente distinto');
    expect(calcularHash(PNG_1PX)).not.toBe(calcularHash(otro));
  });
});

// US-409 v2: limpieza de mejor esfuerzo cuando ya se escribió el binario a
// disco pero el paso siguiente (crear la fila en BD) truena — usada en el
// catch de laboratorio.service.js#subirArchivoParaTodos/subirArchivoParaEstudio.
describe('laboratorio.archivos.eliminarFisico', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('borra el archivo en la ruta absoluta correcta', async () => {
    fs.unlink.mockResolvedValue(undefined);
    await eliminarFisico('7/abc.pdf');
    expect(fs.unlink).toHaveBeenCalledWith(rutaAbsolutaDeArchivo('7/abc.pdf'));
  });

  it('no truena si fs.unlink rechaza (limpieza de mejor esfuerzo)', async () => {
    fs.unlink.mockRejectedValue(new Error('ENOENT'));
    await expect(eliminarFisico('7/abc.pdf')).resolves.toBeUndefined();
  });
});
