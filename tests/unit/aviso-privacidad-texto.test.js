const {
  construirBloquesDesdePaginas,
} = require('../../src/modules/configuracion/aviso-privacidad-pdf-layout');

function run(texto, negrita = false, cursiva = false) {
  return { texto, negrita, cursiva };
}

function linea({ texto, x, y, tamano, ancho, negrita = 0, cursiva = 0, runs, marca = null }) {
  return {
    pagina: 1,
    anchoPagina: 612,
    texto,
    x,
    y,
    tamano,
    ancho,
    proporcionNegrita: negrita,
    proporcionCursiva: cursiva,
    runs: runs || [run(texto, negrita >= 0.65, cursiva >= 0.6)],
    marca,
  };
}

describe('extracción semántica del formato de un PDF', () => {
  it('deriva títulos, énfasis, listas y notas a partir de fuente, tamaño y posición', async () => {
    const bloques = construirBloquesDesdePaginas([
      {
        numero: 1,
        ancho: 612,
        alto: 792,
        lineas: [
          linea({
            texto: 'Documento demostrativo',
            x: 206,
            y: 720,
            tamano: 18,
            ancho: 200,
            negrita: 1,
          }),
          linea({
            texto: 'Subtitulo variable',
            x: 226,
            y: 690,
            tamano: 14,
            ancho: 160,
            negrita: 1,
          }),
          linea({
            texto: 'Encabezado obtenido del formato',
            x: 54,
            y: 650,
            tamano: 14,
            ancho: 260,
            negrita: 1,
          }),
          linea({
            texto:
              'Contenido normal suficientemente largo con enfasis visual para definir el tamaño base del documento.',
            x: 54,
            y: 625,
            tamano: 11,
            ancho: 480,
            negrita: 0.15,
            runs: [
              run('Contenido normal suficientemente largo con '),
              run('enfasis visual', true),
              run(' para definir el tamaño base del documento.'),
            ],
          }),
          linea({
            texto: '1. Primer elemento de una lista.',
            x: 72,
            y: 600,
            tamano: 11,
            ancho: 210,
            marca: {
              tipo: 'numerada',
              xContenido: 92,
              runs: [run('Primer elemento de una lista.')],
            },
          }),
          linea({
            texto: 'Nota presentada en cursivas.',
            x: 92,
            y: 570,
            tamano: 11,
            ancho: 180,
            cursiva: 1,
          }),
        ],
      },
    ]);

    expect(bloques.map((bloque) => bloque.tipo)).toEqual([
      'titulo',
      'subtitulo',
      'seccion',
      'parrafo',
      'lista',
      'nota',
    ]);
    expect(bloques[3].runs.some((fragmento) => fragmento.negrita)).toBe(true);
    expect(bloques[4]).toMatchObject({ tipo: 'lista', ordenada: true });
    expect(bloques[4].elementos[0].runs.map((fragmento) => fragmento.texto).join('')).toBe(
      'Primer elemento de una lista.',
    );
    expect(bloques[5].runs.every((fragmento) => fragmento.cursiva)).toBe(true);
  });
});
