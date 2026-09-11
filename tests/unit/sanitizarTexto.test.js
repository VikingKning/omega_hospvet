const { sanitizarTexto } = require('../../src/config/sanitizarTexto');

describe('sanitizarTexto', () => {
  it('deja intacto el texto plano normal (nombres, acentos, ñ)', () => {
    expect(sanitizarTexto('Juan Pérez')).toBe('Juan Pérez');
    expect(sanitizarTexto('Ñoño Muñoz, área')).toBe('Ñoño Muñoz, área');
  });

  it('no toca apóstrofes ni comillas de texto legítimo', () => {
    expect(sanitizarTexto("O'Brien")).toBe("O'Brien");
  });

  // AC del reporte M-07: sanitize-html re-codifica &/</> del texto que
  // sobrevive a la limpieza (es una librería pensada para producir HTML
  // seguro de insertar, no texto de negocio) — sin el paso de decodificado,
  // "García & Asociados" se guardaría para siempre como "García &amp;
  // Asociados", rompiendo cualquier uso fuera de HTML (WhatsApp, correo).
  it('preserva &, < y > sueltos que no forman parte de una etiqueta real', () => {
    expect(sanitizarTexto('García & Asociados')).toBe('García & Asociados');
    expect(sanitizarTexto('Peso < 5kg, temperatura > 39°C')).toBe('Peso < 5kg, temperatura > 39°C');
  });

  it('elimina una etiqueta <script> junto con su contenido', () => {
    expect(sanitizarTexto('<script>alert(1)</script>')).toBe('');
    expect(sanitizarTexto('Hola <script>alert(1)</script> mundo')).toBe('Hola  mundo');
  });

  it('elimina una etiqueta con atributo de evento (ej. onerror) sin dejar rastro ejecutable', () => {
    expect(sanitizarTexto('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('quita cualquier etiqueta pero conserva su texto interior (no es contenido peligroso en sí)', () => {
    expect(sanitizarTexto('Texto con <b>negritas</b> raras')).toBe('Texto con negritas raras');
  });

  it('un payload ya escapado a mano (&lt;script&gt;) se guarda como texto literal, no como etiqueta', () => {
    expect(sanitizarTexto('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '<script>alert(1)</script>',
    );
  });

  it('valores vacíos/ausentes no truenan', () => {
    expect(sanitizarTexto('')).toBe('');
    expect(sanitizarTexto(null)).toBe('');
    expect(sanitizarTexto(undefined)).toBe('');
  });

  it('convierte a texto cualquier valor no-string antes de sanitizar (nunca truena con un número)', () => {
    expect(sanitizarTexto(42)).toBe('42');
  });
});
