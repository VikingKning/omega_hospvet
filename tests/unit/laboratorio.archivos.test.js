// laboratorio.archivos.js: fusiona varios archivos en un solo PDF (pedido
// explícito del usuario) o guarda uno solo tal cual — sin tocar la base de
// datos (eso vive en laboratorio.repository.js). `fs/promises` mockeado
// para no escribir a disco de verdad en un test unitario; el Buffer que se
// le pasa a writeFile sí es un PDF/imagen real (generado con pdf-lib), así
// que se puede releer con PDFDocument.load() para verificar el resultado.
jest.mock('fs/promises');
const fs = require('fs/promises');
const { PDFDocument } = require('pdf-lib');
const {
  ArchivoValidationError,
  procesarArchivos,
  rutaAbsolutaDeArchivo,
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
