const env = require('../../src/config/env');
const claude = require('../../src/config/claude');

const SLUGS = {
  emergencia: 'emergencia-medica',
  duda_medica: 'sin-coincidencia-default',
  agendar_cita: 'agendar-cita-default',
  resultados_laboratorio: 'resultados-laboratorio-default',
};

describe('config/claude — timeout y catálogo cerrado (US WA 011)', () => {
  const fetchOriginal = global.fetch;
  const apiKeyOriginal = env.anthropic.apiKey;
  const timeoutOriginal = env.anthropic.timeoutMs;

  beforeEach(() => {
    env.anthropic.apiKey = 'test-key';
    env.anthropic.timeoutMs = 25;
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    env.anthropic.apiKey = apiKeyOriginal;
    env.anthropic.timeoutMs = timeoutOriginal;
  });

  it('adjunta una señal de cancelación con el tiempo configurado', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: 'categoria_3' }],
          usage: { input_tokens: 12, output_tokens: 2 },
        }),
    });

    await expect(claude.clasificarMensaje('quiero una cita', [], SLUGS)).resolves.toEqual({
      etiqueta: 'agendar-cita-default',
      tokensEntrada: 12,
      tokensSalida: 2,
    });
    const [, opciones] = global.fetch.mock.calls[0];
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
  });

  it('envía texto minimizado y etiquetas anónimas, sin slugs ni respuestas internas', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: 'opcion_1' }],
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
    });

    await claude.clasificarMensaje(
      'Soy Ana, mi correo es ana@correo.com, teléfono 5512345678 y folio LAB-005',
      [
        {
          slug: 'dosis-olvidada-interna',
          intencion: 'orientar cuando olvidaron una dosis',
          texto_respuesta: 'Texto privado con teléfono 5511111111',
        },
      ],
      SLUGS,
      { nombresConocidos: ['Ana Ruiz'] },
    );

    const cuerpo = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(cuerpo.messages[0].content).toBe(
      'Soy [nombre], mi correo es [correo], teléfono [telefono] y [folio]',
    );
    expect(cuerpo.system).toContain('opcion_1: orientar cuando olvidaron una dosis');
    expect(cuerpo.system).not.toContain('dosis-olvidada-interna');
    expect(cuerpo.system).not.toContain('Texto privado');
    expect(cuerpo.system).not.toContain('5511111111');
  });

  it('normaliza el vencimiento como CLAUDE_TIMEOUT', async () => {
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    global.fetch = jest.fn().mockRejectedValue(timeout);

    await expect(claude.clasificarMensaje('consulta', [], SLUGS)).rejects.toMatchObject({
      code: 'CLAUDE_TIMEOUT',
      message: 'Claude API excedió el tiempo límite de 25 ms.',
    });
  });

  it('convierte una etiqueta fuera del catálogo en sin coincidencia controlada', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: 'respuesta inventada' }],
          usage: { input_tokens: 8, output_tokens: 2 },
        }),
    });

    await expect(claude.clasificarMensaje('consulta', [], SLUGS)).resolves.toEqual({
      etiqueta: null,
      tokensEntrada: 8,
      tokensSalida: 2,
    });
  });
});
