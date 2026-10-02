function redondear(valor, paso = 0.5) {
  return Math.round(valor / paso) * paso;
}

function agregarRun(runs, texto, estilo = {}) {
  const limpio = String(texto || '').replace(/\s+/g, ' ');
  if (!limpio) return;

  const run = {
    texto: limpio,
    negrita: Boolean(estilo.negrita),
    cursiva: Boolean(estilo.cursiva),
  };
  const anterior = runs.at(-1);
  if (anterior && anterior.negrita === run.negrita && anterior.cursiva === run.cursiva) {
    anterior.texto += run.texto;
    return;
  }
  runs.push(run);
}

function limpiarRuns(runs) {
  while (runs.length && !runs[0].texto.trim()) runs.shift();
  while (runs.length && !runs.at(-1).texto.trim()) runs.pop();
  if (runs.length) runs[0].texto = runs[0].texto.trimStart();
  if (runs.length) runs.at(-1).texto = runs.at(-1).texto.trimEnd();
  return runs.filter((run) => run.texto);
}

function construirRuns(fragmentos) {
  const runs = [];
  let extremoAnterior = null;
  let textoAnterior = '';
  let tamanoAnterior = 0;

  for (const fragmento of fragmentos) {
    const texto = String(fragmento.texto || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!texto) continue;

    if (extremoAnterior !== null) {
      const espacio = fragmento.x - extremoAnterior;
      const umbral = Math.max(0.8, Math.min(tamanoAnterior, fragmento.tamano) * 0.12);
      const empiezaConPuntuacion = /^[,.;:!?%)\]}»”]/u.test(texto);
      const anteriorEsApertura = /[([{«“]$/u.test(textoAnterior);
      if (espacio > umbral && !empiezaConPuntuacion && !anteriorEsApertura) {
        agregarRun(runs, ' ', fragmento);
      }
    }

    agregarRun(runs, texto, fragmento);
    extremoAnterior = fragmento.x + fragmento.ancho;
    textoAnterior = texto;
    tamanoAnterior = fragmento.tamano;
  }

  return limpiarRuns(runs);
}

function textoDeRuns(runs) {
  return runs
    .map((run) => run.texto)
    .join('')
    .trim();
}

function estiloDesdeNombre(nombre, familia) {
  const descriptor = `${nombre || ''} ${familia || ''}`;
  return {
    negrita: /bold|black|heavy|semibold|demi/i.test(descriptor),
    cursiva: /italic|oblique/i.test(descriptor),
  };
}

async function obtenerEstilosPagina(page, textContent) {
  const estilos = new Map();
  await page.getOperatorList().catch(() => null);

  for (const [fontName, estiloPdf] of Object.entries(textContent.styles || {})) {
    let nombreFuente = fontName;
    try {
      const fuente = page.commonObjs.get(fontName);
      nombreFuente = fuente?.name || fuente?.loadedName || fontName;
    } catch {
      // Algunos PDFs no exponen el objeto de fuente; se conserva la familia.
    }
    estilos.set(fontName, estiloDesdeNombre(nombreFuente, estiloPdf?.fontFamily));
  }
  return estilos;
}

function agruparFragmentosEnLineas(fragmentos) {
  const lineas = [];
  const ordenados = [...fragmentos].sort((a, b) => b.y - a.y || a.x - b.x);

  for (const fragmento of ordenados) {
    let linea = lineas.find((candidata) => Math.abs(candidata.y - fragmento.y) <= 1.25);
    if (!linea) {
      linea = { y: fragmento.y, fragmentos: [] };
      lineas.push(linea);
    }
    linea.fragmentos.push(fragmento);
  }

  return lineas.sort((a, b) => b.y - a.y);
}

function obtenerMarcaLista(fragmentos) {
  const visibles = fragmentos.filter((fragmento) => fragmento.texto.trim());
  if (!visibles.length) return null;

  const primero = visibles[0].texto.trim();
  const segundo = visibles[1];
  if (/^[•●▪◦‣]$/u.test(primero) && segundo) {
    return { tipo: 'viñetas', contenido: visibles.slice(1), xContenido: segundo.x };
  }
  if (/^\d{1,3}[.)]$/u.test(primero) && segundo) {
    return { tipo: 'numerada', contenido: visibles.slice(1), xContenido: segundo.x };
  }
  return null;
}

function crearLinea(grupo, pagina, anchoPagina) {
  const fragmentos = grupo.fragmentos.sort((a, b) => a.x - b.x);
  const runs = construirRuns(fragmentos);
  const texto = textoDeRuns(runs);
  if (!texto) return null;

  const marca = obtenerMarcaLista(fragmentos);
  const caracteres = fragmentos.reduce(
    (total, fragmento) => total + fragmento.texto.trim().length,
    0,
  );
  const caracteresNegrita = fragmentos.reduce(
    (total, fragmento) => total + (fragmento.negrita ? fragmento.texto.trim().length : 0),
    0,
  );
  const caracteresCursiva = fragmentos.reduce(
    (total, fragmento) => total + (fragmento.cursiva ? fragmento.texto.trim().length : 0),
    0,
  );
  const x = Math.min(...fragmentos.filter((fragmento) => fragmento.texto.trim()).map((f) => f.x));
  const extremo = Math.max(...fragmentos.map((fragmento) => fragmento.x + fragmento.ancho));

  return {
    pagina,
    anchoPagina,
    x,
    y: grupo.y,
    ancho: extremo - x,
    tamano: Math.max(...fragmentos.map((fragmento) => fragmento.tamano)),
    proporcionNegrita: caracteres ? caracteresNegrita / caracteres : 0,
    proporcionCursiva: caracteres ? caracteresCursiva / caracteres : 0,
    runs,
    texto,
    marca: marca
      ? {
          tipo: marca.tipo,
          xContenido: marca.xContenido,
          runs: construirRuns(marca.contenido),
        }
      : null,
  };
}

async function extraerLineasDesdeParser(parser) {
  const doc = await parser.load();
  const paginas = [];

  for (let numero = 1; numero <= doc.numPages; numero += 1) {
    const page = await doc.getPage(numero);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const estilos = await obtenerEstilosPagina(page, textContent);
    const fragmentos = textContent.items
      .filter((item) => 'str' in item && item.str.trim())
      .map((item) => {
        const estilo = estilos.get(item.fontName) || {};
        const tamanoTransformacion = Math.hypot(item.transform?.[0] || 0, item.transform?.[1] || 0);
        return {
          texto: item.str,
          x: item.transform?.[4] || 0,
          y: item.transform?.[5] || 0,
          ancho: item.width || 0,
          tamano: item.height || tamanoTransformacion || 10,
          negrita: estilo.negrita,
          cursiva: estilo.cursiva,
        };
      });

    const lineas = agruparFragmentosEnLineas(fragmentos)
      .map((grupo) => crearLinea(grupo, numero, viewport.width))
      .filter(Boolean);
    paginas.push({ numero, ancho: viewport.width, alto: viewport.height, lineas });
    page.cleanup();
  }

  return paginas;
}

function obtenerTamanoBase(lineas) {
  const frecuencias = new Map();
  for (const linea of lineas) {
    const clave = redondear(linea.tamano);
    frecuencias.set(clave, (frecuencias.get(clave) || 0) + linea.texto.length);
  }
  return [...frecuencias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
}

function obtenerMargenBase(lineas, tamanoBase) {
  const frecuencias = new Map();
  for (const linea of lineas) {
    if (Math.abs(linea.tamano - tamanoBase) > 1) continue;
    const clave = Math.round(linea.x / 4) * 4;
    frecuencias.set(clave, (frecuencias.get(clave) || 0) + linea.texto.length);
  }
  return [...frecuencias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

function agregarRunsConEspacio(destino, nuevos) {
  if (destino.length && nuevos.length) agregarRun(destino, ' ', nuevos[0]);
  for (const run of nuevos) agregarRun(destino, run.texto, run);
}

function clasificarLinea(linea, contexto) {
  const proporcion = linea.tamano / contexto.tamanoBase;
  const centro = linea.x + linea.ancho / 2;
  const centrada = Math.abs(centro - linea.anchoPagina / 2) <= linea.anchoPagina * 0.08;
  const negrita = linea.proporcionNegrita >= 0.65;

  if (linea.marca && proporcion <= 1.12) return 'elemento-lista';
  if (proporcion >= 1.34) return centrada ? 'titulo' : 'seccion';
  if (proporcion >= 1.14 && negrita) return centrada ? 'subtitulo' : 'seccion';
  if (proporcion >= 1.05 && negrita) return 'subseccion';
  if (
    proporcion >= 0.95 &&
    negrita &&
    linea.texto.length <= 110 &&
    contexto.separacionAnterior >= contexto.tamanoBase * 1.65
  ) {
    return 'encabezado';
  }
  if (linea.proporcionCursiva >= 0.6 && linea.x > contexto.margenBase + 12) return 'nota';
  return 'parrafo';
}

function construirBloquesDesdePaginas(paginas) {
  const lineas = paginas.flatMap((pagina) => pagina.lineas);
  if (!lineas.length) return [];
  const tamanoBase = obtenerTamanoBase(lineas);
  const margenBase = obtenerMargenBase(lineas, tamanoBase);
  const bloques = [];
  let anterior = null;

  for (const linea of lineas) {
    const cambioPagina = anterior && anterior.pagina !== linea.pagina;
    const separacionAnterior = anterior
      ? cambioPagina
        ? tamanoBase * 1.2
        : anterior.y - linea.y
      : Number.POSITIVE_INFINITY;
    const tipo = clasificarLinea(linea, { tamanoBase, margenBase, separacionAnterior });
    const bloqueAnterior = bloques.at(-1);

    // Las líneas envueltas de un elemento conservan la sangría del contenido,
    // pero ya no repiten la viñeta o el número. Se anexan al último <li>
    // usando únicamente esa geometría y la distancia vertical del PDF.
    if (
      !linea.marca &&
      bloqueAnterior?.tipo === 'lista' &&
      separacionAnterior <= tamanoBase * 1.75 &&
      Math.abs(linea.x - bloqueAnterior.xContenido) <= tamanoBase * 2
    ) {
      agregarRunsConEspacio(bloqueAnterior.elementos.at(-1).runs, linea.runs);
      anterior = linea;
      continue;
    }

    if (tipo === 'elemento-lista') {
      const runs = linea.marca.runs;
      if (
        bloqueAnterior?.tipo === 'lista' &&
        bloqueAnterior.ordenada === (linea.marca.tipo === 'numerada') &&
        separacionAnterior <= tamanoBase * 1.9
      ) {
        bloqueAnterior.elementos.push({ runs });
      } else {
        bloques.push({
          tipo: 'lista',
          ordenada: linea.marca.tipo === 'numerada',
          xContenido: linea.marca.xContenido,
          elementos: [{ runs }],
        });
      }
      anterior = linea;
      continue;
    }

    const esTextoFluido = tipo === 'parrafo' || tipo === 'nota';
    const mismaClase = bloqueAnterior?.tipo === tipo;
    const continuaEntrePaginas = cambioPagina && !/[.!?:;”")\]]$/u.test(anterior.texto);
    const continuacionVisual =
      continuaEntrePaginas ||
      (!cambioPagina &&
        separacionAnterior <= tamanoBase * 1.65 &&
        Math.abs(linea.x - (bloqueAnterior?.x ?? linea.x)) <= tamanoBase * 3.5);

    if (esTextoFluido && mismaClase && continuacionVisual) {
      agregarRunsConEspacio(bloqueAnterior.runs, linea.runs);
    } else {
      bloques.push({ tipo, runs: [...linea.runs], x: linea.x });
    }
    anterior = linea;
  }

  return bloques;
}

async function extraerContenidoDesdeParser(parser) {
  const paginas = await extraerLineasDesdeParser(parser);
  return {
    texto: paginas
      .map((pagina) => pagina.lineas.map((linea) => linea.texto).join('\n'))
      .join('\n\n'),
    bloques: construirBloquesDesdePaginas(paginas),
  };
}

module.exports = {
  construirBloquesDesdePaginas,
  extraerContenidoDesdeParser,
};
