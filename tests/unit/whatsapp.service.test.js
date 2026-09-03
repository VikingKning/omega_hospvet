jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
jest.mock('../../src/modules/whatsapp/whatsapp.repository');

const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const plantillasRepository = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const { procesarMensajeEntrante } = require('../../src/modules/whatsapp/whatsapp.service');

// fetch real (envío del mensaje de respuesta por WhatsApp) — se mockea
// globalmente, mismo criterio que passwordPolicy.test.js con HIBP.
const originalFetch = global.fetch;

const PLANTILLAS_ACTIVAS = [
  { id: 1, intencion: 'dosis_olvidada', texto_respuesta: 'Respuesta de dosis_olvidada.' },
  { id: 2, intencion: 'duda_medica_general', texto_respuesta: 'Respuesta genérica.' },
];

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  plantillasRepository.findActivasParaClasificar.mockResolvedValue(PLANTILLAS_ACTIVAS);
  repository.crearMensaje.mockResolvedValue(1);
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function textoEnviado() {
  const [, opciones] = global.fetch.mock.calls[0];
  return JSON.parse(opciones.body).text.body;
}

function destinatarioEnviado() {
  const [, opciones] = global.fetch.mock.calls[0];
  return JSON.parse(opciones.body).to;
}

describe('whatsapp.service.procesarMensajeEntrante — categoria_clasificacion', () => {
  it('duda_medica con match: responde el texto_respuesta real de la plantilla e incrementa su uso', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: 'duda_medica', tokensEntrada: 10, tokensSalida: 2 });
    jest
      .spyOn(claude, 'clasificarIntencion')
      .mockResolvedValue({ etiqueta: 'dosis_olvidada', tokensEntrada: 15, tokensSalida: 3 });

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'se me olvidó la pastilla' });

    expect(textoEnviado()).toBe('Respuesta de dosis_olvidada.');
    expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(1);
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriaClasificacion: 'duda_medica',
        plantillaId: 1,
        citaGeneradaId: null,
        registroLaboratorioId: null,
        tokensEntrada: 25, // suma de las 2 llamadas a Claude
        tokensSalida: 5,
      }),
    );
  });

  it('duda_medica sin match de intención: responde el texto de respaldo, plantilla_id queda null', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: 'duda_medica', tokensEntrada: 10, tokensSalida: 2 });
    jest
      .spyOn(claude, 'clasificarIntencion')
      .mockResolvedValue({ etiqueta: claude.SIN_COINCIDENCIA, tokensEntrada: 8, tokensSalida: 3 });

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'algo fuera de catálogo' });

    expect(plantillasRepository.incrementarUso).not.toHaveBeenCalled();
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ categoriaClasificacion: 'duda_medica', plantillaId: null }),
    );
  });

  it.each([
    ['emergencia', 'urgencia'],
    ['agendar_cita', 'agendar'],
    ['resultados_laboratorio', 'laboratorio'],
  ])(
    'categoria %s: guarda la categoría real pero responde un texto de respaldo (sin acción real todavía)',
    async (etiqueta, fragmentoEsperado) => {
      jest
        .spyOn(claude, 'clasificarCategoria')
        .mockResolvedValue({ etiqueta, tokensEntrada: 5, tokensSalida: 1 });
      const spyIntencion = jest.spyOn(claude, 'clasificarIntencion');

      await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'mensaje de prueba' });

      expect(spyIntencion).not.toHaveBeenCalled();
      expect(textoEnviado().toLowerCase()).toContain(fragmentoEsperado);
      expect(repository.crearMensaje).toHaveBeenCalledWith(
        expect.objectContaining({
          categoriaClasificacion: etiqueta,
          plantillaId: null,
          citaGeneradaId: null,
          registroLaboratorioId: null,
          tokensEntrada: 5,
          tokensSalida: 1,
        }),
      );
    },
  );

  it('a un celular mexicano (521...) le quita el "1" extra al responder, aunque se guarda tal cual llegó', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: 'emergencia', tokensEntrada: 5, tokensSalida: 1 });

    await procesarMensajeEntrante({ telefono: '5215529000090', texto: 'urgencia' });

    expect(destinatarioEnviado()).toBe('525529000090');
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ telefonoOrigen: '5215529000090' }),
    );
  });

  it('un número que no es celular mexicano con el patrón 521... se manda sin tocar', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: 'emergencia', tokensEntrada: 5, tokensSalida: 1 });

    await procesarMensajeEntrante({ telefono: '14155551234', texto: 'urgencia' });

    expect(destinatarioEnviado()).toBe('14155551234');
  });

  it('categoría sin match (respuesta inesperada del LLM): guarda sin_coincidencia y responde el texto de respaldo', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: null, tokensEntrada: 5, tokensSalida: 1 });
    const spyIntencion = jest.spyOn(claude, 'clasificarIntencion');

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'algo raro' });

    expect(spyIntencion).not.toHaveBeenCalled();
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriaClasificacion: claude.SIN_COINCIDENCIA,
        plantillaId: null,
      }),
    );
  });
});
