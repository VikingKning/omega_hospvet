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

// Las 4 plantillas predeterminadas del sistema (migración 20260903000002)
// — whatsapp.service.js las busca por slug fijo, nunca por el LLM.
const PLANTILLA_EMERGENCIA = {
  id: 100,
  slug: 'emergencia-medica',
  activo: true,
  texto_respuesta: 'Texto de emergencia predeterminado.',
};
const PLANTILLA_AGENDAR_CITA = {
  id: 101,
  slug: 'agendar-cita-default',
  activo: true,
  texto_respuesta: 'Texto de agendar cita predeterminado.',
};
const PLANTILLA_RESULTADOS_LAB = {
  id: 102,
  slug: 'resultados-laboratorio-default',
  activo: true,
  texto_respuesta: 'Texto de resultados de laboratorio predeterminado.',
};
const PLANTILLA_SIN_COINCIDENCIA = {
  id: 103,
  slug: 'sin-coincidencia-default',
  activo: true,
  texto_respuesta: 'Texto sin coincidencia predeterminado.',
};
const PREDETERMINADAS_POR_SLUG = {
  'emergencia-medica': PLANTILLA_EMERGENCIA,
  'agendar-cita-default': PLANTILLA_AGENDAR_CITA,
  'resultados-laboratorio-default': PLANTILLA_RESULTADOS_LAB,
  'sin-coincidencia-default': PLANTILLA_SIN_COINCIDENCIA,
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  plantillasRepository.findActivasParaClasificar.mockResolvedValue(PLANTILLAS_ACTIVAS);
  plantillasRepository.findBySlug.mockImplementation((slug) =>
    Promise.resolve(PREDETERMINADAS_POR_SLUG[slug]),
  );
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

  it('duda_medica sin match de intención: responde la plantilla predeterminada sin_coincidencia_default', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: 'duda_medica', tokensEntrada: 10, tokensSalida: 2 });
    jest
      .spyOn(claude, 'clasificarIntencion')
      .mockResolvedValue({ etiqueta: claude.SIN_COINCIDENCIA, tokensEntrada: 8, tokensSalida: 3 });

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'algo fuera de catálogo' });

    expect(textoEnviado()).toBe(PLANTILLA_SIN_COINCIDENCIA.texto_respuesta);
    expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(PLANTILLA_SIN_COINCIDENCIA.id);
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriaClasificacion: 'duda_medica',
        plantillaId: PLANTILLA_SIN_COINCIDENCIA.id,
      }),
    );
  });

  it.each([
    ['emergencia', PLANTILLA_EMERGENCIA],
    ['agendar_cita', PLANTILLA_AGENDAR_CITA],
    ['resultados_laboratorio', PLANTILLA_RESULTADOS_LAB],
  ])(
    'categoria %s: guarda la categoría real y responde con la plantilla predeterminada del sistema (sin acción real todavía)',
    async (etiqueta, plantillaPredeterminada) => {
      jest
        .spyOn(claude, 'clasificarCategoria')
        .mockResolvedValue({ etiqueta, tokensEntrada: 5, tokensSalida: 1 });
      const spyIntencion = jest.spyOn(claude, 'clasificarIntencion');

      await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'mensaje de prueba' });

      expect(spyIntencion).not.toHaveBeenCalled();
      expect(textoEnviado()).toBe(plantillaPredeterminada.texto_respuesta);
      expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(plantillaPredeterminada.id);
      expect(repository.crearMensaje).toHaveBeenCalledWith(
        expect.objectContaining({
          categoriaClasificacion: etiqueta,
          plantillaId: plantillaPredeterminada.id,
          citaGeneradaId: null,
          registroLaboratorioId: null,
          tokensEntrada: 5,
          tokensSalida: 1,
        }),
      );
    },
  );

  it('si la plantilla predeterminada no existe o está inactiva, usa el texto de respaldo absoluto sin tronar', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: 'emergencia', tokensEntrada: 5, tokensSalida: 1 });
    plantillasRepository.findBySlug.mockResolvedValue(undefined);

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'mensaje de prueba' });

    expect(plantillasRepository.incrementarUso).not.toHaveBeenCalled();
    expect(textoEnviado()).toEqual(expect.any(String));
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ plantillaId: null }),
    );
  });

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

  it('categoría sin match (respuesta inesperada del LLM): guarda sin_coincidencia y responde la plantilla predeterminada', async () => {
    jest
      .spyOn(claude, 'clasificarCategoria')
      .mockResolvedValue({ etiqueta: null, tokensEntrada: 5, tokensSalida: 1 });
    const spyIntencion = jest.spyOn(claude, 'clasificarIntencion');

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'algo raro' });

    expect(spyIntencion).not.toHaveBeenCalled();
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriaClasificacion: claude.SIN_COINCIDENCIA,
        plantillaId: PLANTILLA_SIN_COINCIDENCIA.id,
      }),
    );
  });
});
