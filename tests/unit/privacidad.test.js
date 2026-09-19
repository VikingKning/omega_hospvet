const {
  minimizarTextoParaClaude,
  enmascararTelefono,
  enmascararCorreo,
  sanitizarParaLog,
} = require('../../src/config/privacidad');

describe('controles de privacidad', () => {
  it('minimiza datos de contacto, folios, enlaces, identificadores y nombres conocidos', () => {
    const texto = minimizarTextoParaClaude(
      'Ana escribió desde 55 1234 5678, ana@example.com, folio LAB-009, cédula 1234567, RFC XAXX010101000 y https://ejemplo.test/x',
      { nombresConocidos: ['Ana Ruiz'] },
    );

    expect(texto).toBe(
      '[nombre] escribió desde [telefono], [correo], [folio], [folio], RFC [identificador] y [enlace]',
    );
  });

  it('enmascara destinatarios sin devolver el dato completo', () => {
    expect(enmascararTelefono('+52 55 1234 5678')).toBe('******5678');
    expect(enmascararCorreo('ana@example.com')).toBe('an***@e***.com');
  });

  it('sanitiza objetos de log y errores externos de forma recursiva', () => {
    const error = new Error(
      'Meta rechazó a ana@example.com para +52 55 1234 5678 con Bearer secreto-123',
    );
    error.code = 'META_ERROR';

    const limpio = sanitizarParaLog({
      telefono: '5512345678',
      destinatario: 'ana@example.com',
      payload: { mensaje: 'dato clínico' },
      token: 'secreto',
      err: error,
    });
    const serializado = JSON.stringify(limpio);

    expect(limpio.telefono).toMatch(/^tel_[a-f0-9]{12}$/);
    expect(serializado).not.toContain('5512345678');
    expect(serializado).not.toContain('ana@example.com');
    expect(serializado).not.toContain('dato clínico');
    expect(serializado).not.toContain('secreto-123');
    expect(limpio.err).toEqual(expect.objectContaining({ type: 'Error', code: 'META_ERROR' }));
  });
});
