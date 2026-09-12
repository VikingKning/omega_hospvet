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
  {
    id: 1,
    intencion: 'dosis_olvidada',
    slug: 'dosis-olvidada',
    texto_respuesta: 'Respuesta de dosis_olvidada.',
  },
  {
    id: 2,
    intencion: 'duda_medica_general',
    slug: 'duda-medica-general',
    texto_respuesta: 'Respuesta genérica.',
  },
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

function mockClasificarMensaje(etiqueta, { tokensEntrada = 12, tokensSalida = 3 } = {}) {
  jest
    .spyOn(claude, 'clasificarMensaje')
    .mockResolvedValue({ etiqueta, tokensEntrada, tokensSalida });
}

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

describe('whatsapp.service.procesarMensajeEntrante — clasificación en una sola llamada, catálogo real y categorías fijas compitiendo juntas', () => {
  it('el mensaje se clasifica contra TODO el catálogo real activo en una sola llamada a claude.clasificarMensaje', async () => {
    mockClasificarMensaje('dosis_olvidada', { tokensEntrada: 15, tokensSalida: 3 });

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'se me olvidó la pastilla' });

    expect(claude.clasificarMensaje).toHaveBeenCalledTimes(1);
    expect(claude.clasificarMensaje).toHaveBeenCalledWith(
      'se me olvidó la pastilla',
      PLANTILLAS_ACTIVAS,
    );
    expect(textoEnviado()).toBe('Respuesta de dosis_olvidada.');
    expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(1);
    expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        plantilla: 'dosis_olvidada',
        plantillaId: 1,
        destinatarioTelefono: '525500000000',
        exitoso: true,
        origen: 'respuesta_automatica',
      }),
    );
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriaClasificacion: 'duda_medica',
        plantillaId: 1,
        citaGeneradaId: null,
        registroLaboratorioId: null,
        tokensEntrada: 15,
        tokensSalida: 3,
      }),
    );
  });

  it('normaliza al enviar el formato inválido guardado por versiones anteriores del editor', async () => {
    const plantillaLegada = {
      id: 3,
      intencion: 'urgencia_por_ahogamiento',
      slug: 'urgencia-por-ahogamiento',
      texto_respuesta: '_*No respira: *_cierra el hocico.',
    };
    plantillasRepository.findActivasParaClasificar.mockResolvedValue([
      ...PLANTILLAS_ACTIVAS,
      plantillaLegada,
    ]);
    mockClasificarMensaje(plantillaLegada.intencion);

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'se está ahogando' });

    expect(textoEnviado()).toBe('_*No respira:*_ cierra el hocico.');
  });

  it.each([
    ['emergencia', PLANTILLA_EMERGENCIA],
    ['agendar_cita', PLANTILLA_AGENDAR_CITA],
    ['resultados_laboratorio', PLANTILLA_RESULTADOS_LAB],
  ])(
    'si Claude elige la categoría genérica %s en vez de una intención del catálogo, guarda esa categoría y responde con la plantilla predeterminada del sistema',
    async (etiqueta, plantillaPredeterminada) => {
      mockClasificarMensaje(etiqueta, { tokensEntrada: 13, tokensSalida: 4 });

      await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'mensaje de prueba' });

      expect(textoEnviado()).toBe(plantillaPredeterminada.texto_respuesta);
      expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(plantillaPredeterminada.id);
      expect(repository.crearMensaje).toHaveBeenCalledWith(
        expect.objectContaining({
          categoriaClasificacion: etiqueta,
          plantillaId: plantillaPredeterminada.id,
          citaGeneradaId: null,
          registroLaboratorioId: null,
          tokensEntrada: 13,
          tokensSalida: 4,
        }),
      );
    },
  );

  it("categoría genérica 'duda_medica' (sin plantilla predeterminada propia) cae al respaldo sin_coincidencia_default", async () => {
    mockClasificarMensaje('duda_medica');

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'mensaje de prueba' });

    expect(textoEnviado()).toBe(PLANTILLA_SIN_COINCIDENCIA.texto_respuesta);
    expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(PLANTILLA_SIN_COINCIDENCIA.id);
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ categoriaClasificacion: 'duda_medica' }),
    );
  });

  it('sin match en el catálogo ni en las 4 categorías fijas (etiqueta null): responde la plantilla predeterminada sin_coincidencia_default', async () => {
    mockClasificarMensaje(null);

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'algo raro' });

    expect(textoEnviado()).toBe(PLANTILLA_SIN_COINCIDENCIA.texto_respuesta);
    expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(PLANTILLA_SIN_COINCIDENCIA.id);
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriaClasificacion: claude.SIN_COINCIDENCIA,
        plantillaId: PLANTILLA_SIN_COINCIDENCIA.id,
      }),
    );
  });

  it('si la plantilla predeterminada de respaldo no existe o está inactiva, usa el texto de respaldo absoluto sin tronar', async () => {
    mockClasificarMensaje('emergencia');
    plantillasRepository.findBySlug.mockResolvedValue(undefined);

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'mensaje de prueba' });

    expect(plantillasRepository.incrementarUso).not.toHaveBeenCalled();
    expect(textoEnviado()).toEqual(expect.any(String));
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ plantillaId: null }),
    );
  });

  it('a un celular mexicano (521...) le quita el "1" extra al responder, aunque se guarda tal cual llegó', async () => {
    mockClasificarMensaje('emergencia');

    await procesarMensajeEntrante({ telefono: '5215529000090', texto: 'urgencia' });

    expect(destinatarioEnviado()).toBe('525529000090');
    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ telefonoOrigen: '5215529000090' }),
    );
  });

  it('un número que no es celular mexicano con el patrón 521... se manda sin tocar', async () => {
    mockClasificarMensaje('emergencia');

    await procesarMensajeEntrante({ telefono: '14155551234', texto: 'urgencia' });

    expect(destinatarioEnviado()).toBe('14155551234');
  });

  it('audita el error de Meta y conserva el mensaje entrante aunque falle la respuesta', async () => {
    mockClasificarMensaje('emergencia');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { code: 131030, message: 'Teléfono inválido.' } }),
    });

    await expect(
      procesarMensajeEntrante({ telefono: '5215500000000', texto: 'urgencia' }),
    ).rejects.toThrow('Teléfono inválido.');

    expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        exitoso: false,
        errorCodigo: '131030',
        errorMensaje: 'Teléfono inválido.',
      }),
    );
    expect(repository.crearMensaje).toHaveBeenCalled();
  });

  it('si Claude regresa una etiqueta que no está ni en el catálogo ni en las categorías (defensivo), cae igual al respaldo', async () => {
    mockClasificarMensaje('una_intencion_que_ya_no_existe');

    await procesarMensajeEntrante({ telefono: '5215500000000', texto: 'algo raro' });

    expect(repository.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriaClasificacion: 'una_intencion_que_ya_no_existe',
        plantillaId: PLANTILLA_SIN_COINCIDENCIA.id,
      }),
    );
  });
});
