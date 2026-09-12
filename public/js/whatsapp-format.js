(function inicializarWhatsappFormat(global) {
  const ETIQUETAS = { '*': 'strong', _: 'em', '~': 's' };
  const MARCADORES = new Set(Object.keys(ETIQUETAS));

  function escaparHtml(texto) {
    return String(texto).replace(/[&<>]/g, (caracter) => {
      if (caracter === '&') return '&amp;';
      if (caracter === '<') return '&lt;';
      return '&gt;';
    });
  }

  function esLimiteInicial(caracter) {
    return !caracter || /[\s([\]{>"'¿¡*_~]/u.test(caracter);
  }

  function esLimiteFinal(caracter) {
    return !caracter || /[\s)\]}<"'.,!?;:*_~]/u.test(caracter);
  }

  function buscarCierre(texto, marcador, desde) {
    for (let indice = desde; indice < texto.length; indice += 1) {
      if (texto[indice] === marcador && esLimiteFinal(texto[indice + 1])) return indice;
    }
    return -1;
  }

  // Repara la salida de versiones anteriores del editor, que podían
  // guardar el espacio final dentro de uno o varios formatos. Se itera
  // porque primero se corrige el marcador interior y luego el exterior:
  // _*No respira: *_cierra -> _*No respira:*_ cierra.
  function normalizarFormatoWhatsapp(texto) {
    let resultado = String(texto ?? '');
    let anterior;
    const espacioAntesDelCierre =
      /(^|[\s([\]{>"'¿¡*_~])([*_~])(\S(?:[^\n]*?\S)?)([ \t]+)\2/gu;

    do {
      anterior = resultado;
      resultado = resultado.replace(espacioAntesDelCierre, '$1$2$3$2$4');
    } while (resultado !== anterior);

    return resultado;
  }

  // Los espacios al principio o al final de una selección deben quedar
  // fuera de los marcadores. Además de ser la sintaxis aceptada por
  // WhatsApp, esto mantiene válidos los formatos anidados.
  function envolverConMarcadorWhatsapp(contenido, marcador) {
    const partes = /^(\s*)([\s\S]*?\S)(\s*)$/u.exec(String(contenido));
    if (!partes) return String(contenido);
    return `${partes[1]}${marcador}${partes[2]}${marcador}${partes[3]}`;
  }

  // WhatsApp permite combinar sus estilos envolviendo marcadores, por
  // ejemplo _*texto*_ o *_texto_*. El contenido de cada estilo se procesa
  // recursivamente para conservar cualquiera de los dos órdenes.
  function parsearInlineWhatsapp(texto) {
    const fuente = normalizarFormatoWhatsapp(texto);
    let html = '';
    let indice = 0;

    while (indice < fuente.length) {
      if (fuente.startsWith('```', indice)) {
        const cierre = fuente.indexOf('```', indice + 3);
        if (cierre > indice + 3) {
          html += `<code class="wa-mono">${escaparHtml(fuente.slice(indice + 3, cierre))}</code>`;
          indice = cierre + 3;
          continue;
        }
      }

      if (fuente[indice] === '`') {
        const cierre = fuente.indexOf('`', indice + 1);
        if (cierre > indice + 1) {
          html += `<code class="wa-code">${escaparHtml(fuente.slice(indice + 1, cierre))}</code>`;
          indice = cierre + 1;
          continue;
        }
      }

      const marcador = fuente[indice];
      if (MARCADORES.has(marcador) && esLimiteInicial(fuente[indice - 1])) {
        const cierre = buscarCierre(fuente, marcador, indice + 1);
        if (cierre > indice + 1) {
          const etiqueta = ETIQUETAS[marcador];
          const contenido = parsearInlineWhatsapp(fuente.slice(indice + 1, cierre));
          html += `<${etiqueta}>${contenido}</${etiqueta}>`;
          indice = cierre + 1;
          continue;
        }
      }

      html += escaparHtml(fuente[indice]);
      indice += 1;
    }

    return html;
  }

  const api = {
    envolverConMarcadorWhatsapp,
    normalizarFormatoWhatsapp,
    parsearInlineWhatsapp,
  };
  global.WhatsappFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
