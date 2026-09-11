const sanitizeBody = require('../../src/middlewares/sanitizeBody');

function runMiddleware(body) {
  const req = { body };
  const next = jest.fn();
  sanitizeBody(req, {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req.body;
}

describe('sanitizeBody', () => {
  it('sanitiza cada campo de texto de nivel superior', () => {
    const body = runMiddleware({ nombre: '<script>alert(1)</script>Juan', motivo: 'Cita normal' });
    expect(body).toEqual({ nombre: 'Juan', motivo: 'Cita normal' });
  });

  it('sanitiza recursivamente arreglos de objetos (ej. pacientes[] de tutores)', () => {
    const body = runMiddleware({
      pacientes: [{ nombre: '<img src=x onerror=alert(1)>Firulais' }, { nombre: 'Michi' }],
    });
    expect(body).toEqual({ pacientes: [{ nombre: 'Firulais' }, { nombre: 'Michi' }] });
  });

  it('deja intactos los valores no-string (ids, booleanos, null)', () => {
    const body = runMiddleware({ id: 42, activo: true, doctorId: null });
    expect(body).toEqual({ id: 42, activo: true, doctorId: null });
  });

  // Reporte M-07: nunca se debe transformar una contraseña en texto plano —
  // podría alterar un símbolo legítimo (ej. `<`/`&`) y romper login/cambio
  // de contraseña de forma silenciosa e intermitente.
  it.each(['password', 'confirmacion', 'passwordActual', 'passwordNueva'])(
    'nunca sanitiza el campo %s (contraseñas en texto plano)',
    (campo) => {
      const valorOriginal = 'Cl@ve<segura>&rara123456789';
      const body = runMiddleware({ [campo]: valorOriginal });
      expect(body[campo]).toBe(valorOriginal);
    },
  );

  it('req.body ausente o no-objeto no truena (ej. GET sin body)', () => {
    const req = {};
    const next = jest.fn();
    sanitizeBody(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toBeUndefined();
  });
});
