const {
  envolverConMarcadorWhatsapp,
  normalizarFormatoWhatsapp,
  parsearInlineWhatsapp,
} = require('../../public/js/whatsapp-format');

describe('formato visual de WhatsApp', () => {
  it.each([
    ['*negrita*', '<strong>negrita</strong>'],
    ['_cursiva_', '<em>cursiva</em>'],
    ['~tachado~', '<s>tachado</s>'],
    ['`código`', '<code class="wa-code">código</code>'],
    ['```mono```', '<code class="wa-mono">mono</code>'],
  ])('convierte el formato simple %s', (texto, esperado) => {
    expect(parsearInlineWhatsapp(texto)).toBe(esperado);
  });

  it.each([
    ['_*7711634578*_', '<em><strong>7711634578</strong></em>'],
    ['*_7711634578_*', '<strong><em>7711634578</em></strong>'],
    ['~_*texto*_~', '<s><em><strong>texto</strong></em></s>'],
    ['*negrita y _también cursiva_*', '<strong>negrita y <em>también cursiva</em></strong>'],
  ])('conserva los formatos combinados de %s', (texto, esperado) => {
    expect(parsearInlineWhatsapp(texto)).toBe(esperado);
  });

  it('no interpreta marcadores dentro de código monoespaciado', () => {
    expect(parsearInlineWhatsapp('```_*texto*_```')).toBe('<code class="wa-mono">_*texto*_</code>');
  });

  it.each([
    ['_*No respira: *_cierra el hocico', '<em><strong>No respira:</strong></em> cierra el hocico'],
    ['_*Sin pulso: *_RCP', '<em><strong>Sin pulso:</strong></em> RCP'],
  ])('muestra el formato combinado legado de %s', (texto, esperado) => {
    expect(parsearInlineWhatsapp(texto)).toBe(esperado);
  });

  it('conserva guiones bajos técnicos y escapa HTML', () => {
    expect(parsearInlineWhatsapp('resultados_laboratorio_listos_v2 <script>')).toBe(
      'resultados_laboratorio_listos_v2 &lt;script&gt;',
    );
  });
});

describe('serialización del formato visual de WhatsApp', () => {
  it('normaliza los espacios de textos que ya estaban guardados', () => {
    expect(normalizarFormatoWhatsapp('_*No respira: *_cierra')).toBe('_*No respira:*_ cierra');
  });

  it('deja fuera del marcador los espacios de la selección', () => {
    expect(envolverConMarcadorWhatsapp(' No respira: ', '*')).toBe(' *No respira:* ');
  });

  it('mantiene válido el formato anidado aunque se haya seleccionado el espacio final', () => {
    const negrita = envolverConMarcadorWhatsapp('No respira: ', '*');
    expect(envolverConMarcadorWhatsapp(negrita, '_')).toBe('_*No respira:*_ ');
  });
});
