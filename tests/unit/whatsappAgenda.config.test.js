const env = require('../../src/config/env');
const {
  validarUrlHttps,
  obtenerConfiguracionRuta,
  construirTextoEnlace,
  validarConfiguracionAlArrancar,
} = require('../../src/config/whatsappAgenda');

describe('config/whatsappAgenda (US WA 006)', () => {
  const consultaOriginal = env.enlaces.calendarioCitas;
  const esteticaOriginal = env.enlaces.calendarioEstetica;

  afterEach(() => {
    env.enlaces.calendarioCitas = consultaOriginal;
    env.enlaces.calendarioEstetica = esteticaOriginal;
  });

  it.each([
    undefined,
    '',
    '   ',
    'http://calendar.example/cita',
    'calendar.example/cita',
    'no-es-url',
  ])('rechaza una URL ausente, inválida o sin HTTPS: %p', (valor) =>
    expect(validarUrlHttps(valor)).toBeNull(),
  );

  it('acepta y conserva una URL HTTPS completa', () => {
    expect(validarUrlHttps(' https://calendar.example/cita?id=1 ')).toBe(
      'https://calendar.example/cita?id=1',
    );
  });

  it('usa variables distintas para Consulta y Estética y construye texto determinista', () => {
    env.enlaces.calendarioCitas = 'https://calendar.example/consulta';
    env.enlaces.calendarioEstetica = 'https://calendar.example/estetica';

    expect(obtenerConfiguracionRuta('agendar_consulta')).toMatchObject({
      tipoCita: 'Consulta',
      variable: 'GOOGLE_CALENDAR_MEETING_URL',
      url: 'https://calendar.example/consulta',
    });
    expect(obtenerConfiguracionRuta('agendar_estetica')).toMatchObject({
      tipoCita: 'Estética',
      variable: 'GOOGLE_CALENDAR_GROOMING',
      url: 'https://calendar.example/estetica',
    });
    const texto = construirTextoEnlace('Consulta', 'https://calendar.example/consulta');
    expect(texto).toContain('Consulta');
    expect(texto).toContain('\nhttps://calendar.example/consulta');
  });

  it('al arrancar avisa sin imprimir el valor configurado', () => {
    env.enlaces.calendarioCitas = 'http://url-privada.example/consulta';
    env.enlaces.calendarioEstetica = undefined;
    const logger = { warn: jest.fn() };

    validarConfiguracionAlArrancar(logger);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    const serializado = JSON.stringify(logger.warn.mock.calls);
    expect(serializado).toContain('GOOGLE_CALENDAR_MEETING_URL');
    expect(serializado).toContain('GOOGLE_CALENDAR_GROOMING');
    expect(serializado).not.toContain('url-privada.example');
  });
});
