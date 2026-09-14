jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
jest.mock('../../src/modules/whatsapp/whatsapp.repository');
jest.mock('../../src/modules/whatsapp/whatsapp.outbox');
jest.mock('../../src/modules/laboratorio/laboratorio.service');

const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const plantillasRepository = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');
const laboratorioService = require('../../src/modules/laboratorio/laboratorio.service');
const {
  registrarEventoEntrante,
  procesarMensajePendiente,
  procesarSiguienteConversacionVencida,
  enviarMenuPrincipal,
  procesarSiguienteSeguimientoPendiente,
  cerrarSiguienteConversacionInactiva,
  reenviarSeguimiento,
  enviarSeleccionInvalida,
  enviarPasoLaboratorio,
} = require('../../src/modules/whatsapp/whatsapp.service');

// fetch real (envío del mensaje de respuesta por WhatsApp) — se mockea
// globalmente, mismo criterio que passwordPolicy.test.js con HIBP.
const originalFetch = global.fetch;

const MENSAJE_ID = 42;
const CONVERSACION_ID = 55;
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
  repository.registrarMensajeYConversacion.mockResolvedValue({ id: MENSAJE_ID, esNuevo: true });
  repository.reclamarPendiente.mockResolvedValue(true);
  repository.findPendientePorId.mockResolvedValue({
    id: MENSAJE_ID,
    telefono_origen: '5215500000000',
    mensaje_recibido: 'mensaje de prueba',
    conversacion_id: CONVERSACION_ID,
    conversacion_estado: 'acumulando',
  });
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

describe('whatsapp.service.registrarEventoEntrante — solo persiste y asocia, nunca clasifica', () => {
  it('delega en repository.registrarMensajeYConversacion con el teléfono normalizado, sin llamar a Claude', async () => {
    repository.registrarMensajeYConversacion.mockResolvedValue({ id: 7, esNuevo: true });

    const resultado = await registrarEventoEntrante({
      whatsappMessageId: 'wamid.1',
      from: '5215500000000',
      phoneNumberId: 'phone-1',
      timestamp: '1700000000',
      tipoMensaje: 'text',
      contenido: 'hola',
      mediaId: null,
    });

    expect(repository.registrarMensajeYConversacion).toHaveBeenCalledWith({
      whatsappMessageId: 'wamid.1',
      telefonoOrigen: '5215500000000',
      phoneNumberId: 'phone-1',
      telefonoNormalizado: '525500000000',
      tipoMensaje: 'text',
      contenido: 'hola',
      mediaId: null,
      mimeType: null,
      tituloInteractivo: null,
      recibidoEn: new Date(1700000000 * 1000),
    });
    expect(resultado).toEqual(
      expect.objectContaining({ id: 7, esNuevo: true, telefonoNormalizado: '525500000000' }),
    );
  });

  it('normaliza un celular mexicano (521...) quitando el "1" extra', async () => {
    await registrarEventoEntrante({
      whatsappMessageId: 'wamid.2',
      from: '5215529000090',
      phoneNumberId: 'phone-1',
      timestamp: '1700000000',
      tipoMensaje: 'text',
      contenido: 'hola',
      mediaId: null,
    });

    expect(repository.registrarMensajeYConversacion).toHaveBeenCalledWith(
      expect.objectContaining({ telefonoNormalizado: '525529000090' }),
    );
  });
});

describe('whatsapp.service.procesarMensajePendiente — catálogo real y categorías fijas compitiendo juntas', () => {
  it('si reclamarPendiente devuelve false (ya lo tomó otro disparador), no hace nada más', async () => {
    repository.reclamarPendiente.mockResolvedValue(false);
    mockClasificarMensaje('dosis_olvidada');

    await procesarMensajePendiente(MENSAJE_ID);

    expect(repository.findPendientePorId).not.toHaveBeenCalled();
    expect(claude.clasificarMensaje).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(repository.marcarProcesado).not.toHaveBeenCalled();
  });

  it('el catálogo real se prueba contra TODO lo activo — si hay match, responde su texto_respuesta, marca procesado y cierra la conversación', async () => {
    mockClasificarMensaje('dosis_olvidada', { tokensEntrada: 15, tokensSalida: 3 });

    await procesarMensajePendiente(MENSAJE_ID);

    expect(repository.reclamarPendiente).toHaveBeenCalledWith(MENSAJE_ID);
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
    expect(repository.marcarProcesado).toHaveBeenCalledWith(MENSAJE_ID, {
      categoriaClasificacion: 'duda_medica',
      plantillaId: 1,
      tokensEntrada: 15,
      tokensSalida: 3,
    });
    expect(repository.cerrarConversacion).toHaveBeenCalledWith(CONVERSACION_ID, expect.any(Date));
  });

  it.each([
    ['emergencia', PLANTILLA_EMERGENCIA],
    ['agendar_cita', PLANTILLA_AGENDAR_CITA],
    ['resultados_laboratorio', PLANTILLA_RESULTADOS_LAB],
  ])(
    'si Claude elige la categoría genérica %s en vez de una intención del catálogo, guarda esa categoría y responde con la plantilla predeterminada',
    async (etiqueta, plantillaPredeterminada) => {
      mockClasificarMensaje(etiqueta, { tokensEntrada: 13, tokensSalida: 4 });

      await procesarMensajePendiente(MENSAJE_ID);

      expect(textoEnviado()).toBe(plantillaPredeterminada.texto_respuesta);
      expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(plantillaPredeterminada.id);
      expect(repository.marcarProcesado).toHaveBeenCalledWith(MENSAJE_ID, {
        categoriaClasificacion: etiqueta,
        plantillaId: plantillaPredeterminada.id,
        tokensEntrada: 13,
        tokensSalida: 4,
      });
    },
  );

  it("categoría genérica 'duda_medica' (sin plantilla predeterminada propia) cae al respaldo sin_coincidencia_default", async () => {
    mockClasificarMensaje('duda_medica');

    await procesarMensajePendiente(MENSAJE_ID);

    expect(textoEnviado()).toBe(PLANTILLA_SIN_COINCIDENCIA.texto_respuesta);
    expect(repository.marcarProcesado).toHaveBeenCalledWith(
      MENSAJE_ID,
      expect.objectContaining({
        categoriaClasificacion: 'duda_medica',
        plantillaId: PLANTILLA_SIN_COINCIDENCIA.id,
      }),
    );
  });

  it('sin match en el catálogo ni en las 4 categorías fijas (etiqueta null): responde la plantilla sin_coincidencia_default', async () => {
    mockClasificarMensaje(null);

    await procesarMensajePendiente(MENSAJE_ID);

    expect(textoEnviado()).toBe(PLANTILLA_SIN_COINCIDENCIA.texto_respuesta);
    expect(repository.marcarProcesado).toHaveBeenCalledWith(
      MENSAJE_ID,
      expect.objectContaining({ categoriaClasificacion: claude.SIN_COINCIDENCIA }),
    );
  });

  it('si la clasificación misma truena (ej. Claude no configurado), marca error y relanza sin llegar a enviar', async () => {
    jest.spyOn(claude, 'clasificarMensaje').mockRejectedValue(new Error('Claude no configurado.'));

    await expect(procesarMensajePendiente(MENSAJE_ID)).rejects.toThrow('Claude no configurado.');

    expect(repository.marcarError).toHaveBeenCalledWith(MENSAJE_ID);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(repository.marcarProcesado).not.toHaveBeenCalled();
    expect(repository.cerrarConversacion).not.toHaveBeenCalled();
  });

  it('a un celular mexicano (521...) le quita el "1" extra al responder', async () => {
    repository.findPendientePorId.mockResolvedValue({
      id: MENSAJE_ID,
      telefono_origen: '5215529000090',
      mensaje_recibido: 'urgencia',
      conversacion_id: CONVERSACION_ID,
      conversacion_estado: 'acumulando',
    });
    mockClasificarMensaje('emergencia');

    await procesarMensajePendiente(MENSAJE_ID);

    expect(destinatarioEnviado()).toBe('525529000090');
  });

  it('audita el error de Meta, aun así marca procesado, pero NO cierra la conversación (AC9)', async () => {
    mockClasificarMensaje('emergencia');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { code: 131030, message: 'Teléfono inválido.' } }),
    });

    await expect(procesarMensajePendiente(MENSAJE_ID)).rejects.toThrow('Teléfono inválido.');

    expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        exitoso: false,
        errorCodigo: '131030',
        errorMensaje: 'Teléfono inválido.',
      }),
    );
    expect(repository.marcarProcesado).toHaveBeenCalledWith(
      MENSAJE_ID,
      expect.objectContaining({ categoriaClasificacion: 'emergencia' }),
    );
    expect(repository.cerrarConversacion).not.toHaveBeenCalled();
  });

  it.each(['esperando_menu', 'flujo_activo', 'atencion_humana'])(
    'si la conversación ya no está acumulando (%s), no clasifica ni envía — solo marca procesado sin categoría',
    async (estado) => {
      repository.findPendientePorId.mockResolvedValue({
        id: MENSAJE_ID,
        telefono_origen: '5215500000000',
        mensaje_recibido: 'menu',
        conversacion_id: CONVERSACION_ID,
        conversacion_estado: estado,
      });
      jest.spyOn(claude, 'clasificarMensaje');

      await procesarMensajePendiente(MENSAJE_ID);

      expect(claude.clasificarMensaje).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(repository.marcarProcesado).toHaveBeenCalledWith(MENSAJE_ID, {
        categoriaClasificacion: null,
        plantillaId: null,
        tokensEntrada: 0,
        tokensSalida: 0,
      });
      expect(repository.cerrarConversacion).not.toHaveBeenCalled();
    },
  );

  it('simula un reinicio de PM2: procesar directamente una fila persistida de antemano, sin nada en memoria previo, funciona igual', async () => {
    // No hay ningún estado "recordado" de un supuesto webhook anterior —
    // es exactamente lo que vería whatsappMensajesPendientesJob.js al
    // encontrar esta fila fría tras un reinicio.
    repository.findPendientePorId.mockResolvedValue({
      id: 999,
      telefono_origen: '5215500000000',
      mensaje_recibido: 'se me olvidó la pastilla',
      conversacion_id: CONVERSACION_ID,
      conversacion_estado: 'acumulando',
    });
    mockClasificarMensaje('dosis_olvidada');

    await procesarMensajePendiente(999);

    expect(repository.reclamarPendiente).toHaveBeenCalledWith(999);
    expect(textoEnviado()).toBe('Respuesta de dosis_olvidada.');
    expect(repository.marcarProcesado).toHaveBeenCalledWith(999, expect.any(Object));
    expect(repository.cerrarConversacion).toHaveBeenCalledWith(CONVERSACION_ID, expect.any(Date));
  });
});

// US WA 004 — menú interactivo inicial. whatsapp.repository y
// whatsapp.outbox se mockean wholesale: aquí se prueba la LÓGICA de
// decisión (saludo/comando -> menú, éxito/fallo -> transición), no la
// idempotencia real del outbox (eso ya vive en tests/unit/whatsapp.outbox.test.js
// y tests/integration/whatsapp.outbox.test.js) ni el timing real de la
// ventana de agrupación (tests/integration/whatsapp.agrupacion.test.js).
describe('whatsapp.service — menú interactivo inicial (US WA 004)', () => {
  const GROUP_ID = 'grupo-uuid-1';

  beforeEach(() => {
    repository.reclamarConversacionVencida.mockResolvedValue(CONVERSACION_ID);
    repository.obtenerContextoDeConversacion.mockResolvedValue({
      telefonoNormalizado: '525500000000',
      flujoActual: null,
      pasoActual: null,
      grupoMedioPendienteId: null,
    });
    repository.confirmarMenuEnviado.mockResolvedValue(true);
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia }, esNuevo: true }),
    );
  });

  it('un grupo cuyo texto consolidado es un saludo puro dispara enviarMenuPrincipal (AC1)', async () => {
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: 'hola',
      tieneTextoProcesable: true,
    });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(outbox.ejecutarIntento).toHaveBeenCalledTimes(1);
    expect(outbox.ejecutarIntento).toHaveBeenCalledWith(`grupo:${GROUP_ID}:menu`);
    expect(repository.confirmarMenuEnviado).toHaveBeenCalledWith(CONVERSACION_ID);
    expect(resultado).toEqual(
      expect.objectContaining({ groupId: GROUP_ID, resultado: 'menu_enviado' }),
    );
  });

  it('un grupo con texto normal (ni saludo ni comando) regresa no_resuelto y cierra la conversación (AC3/AC4)', async () => {
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: 'mi perro no come',
      tieneTextoProcesable: true,
    });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(outbox.registrarIntento).not.toHaveBeenCalled();
    expect(repository.confirmarMenuEnviado).not.toHaveBeenCalled();
    // Corrección: sin cerrar aquí, formarGrupoParaConversacion reutilizaría
    // este mismo grupo para siempre, dejando huérfano cualquier mensaje
    // posterior del tutor sobre esta misma conversación (bug encontrado
    // probando en vivo — ver comentario en whatsapp.service.js).
    expect(repository.cerrarConversacion).toHaveBeenCalledWith(CONVERSACION_ID, expect.any(Date));
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'no_resuelto' }));
  });

  it('si no se formó ningún grupo (AC14 de WA003), no evalúa nada y regresa null', async () => {
    repository.formarGrupoParaConversacion.mockResolvedValue(null);

    const resultado = await procesarSiguienteConversacionVencida();

    expect(resultado).toBeNull();
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
  });

  it('si Meta rechaza el menú interactivo, intenta un respaldo de texto y confirma esperando_menu si tiene éxito (AC6, prueba mínima 8)', async () => {
    outbox.ejecutarIntento
      .mockResolvedValueOnce({
        enviado: false,
        error: 'Plantilla no aprobada.',
        errorCodigo: '131009',
      })
      .mockResolvedValueOnce({ enviado: true, wamid: 'wamid.respaldo' });

    const enviado = await enviarMenuPrincipal({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      claveBase: `grupo:${GROUP_ID}`,
    });

    expect(enviado).toBe(true);
    expect(outbox.ejecutarIntento).toHaveBeenCalledTimes(2);
    expect(outbox.ejecutarIntento).toHaveBeenNthCalledWith(1, `grupo:${GROUP_ID}:menu`);
    expect(outbox.ejecutarIntento).toHaveBeenNthCalledWith(2, `grupo:${GROUP_ID}:menu:respaldo`);
    expect(repository.confirmarMenuEnviado).toHaveBeenCalledWith(CONVERSACION_ID);
  });

  it('si también falla el respaldo de texto, no confirma esperando_menu (AC7, prueba mínima 9)', async () => {
    outbox.ejecutarIntento
      .mockResolvedValueOnce({
        enviado: false,
        error: 'Plantilla no aprobada.',
        errorCodigo: '131009',
      })
      .mockResolvedValueOnce({ enviado: false, error: 'Número inválido.', errorCodigo: '131030' });

    const enviado = await enviarMenuPrincipal({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      claveBase: `grupo:${GROUP_ID}`,
    });

    expect(enviado).toBe(false);
    expect(repository.confirmarMenuEnviado).not.toHaveBeenCalled();
  });

  it('si ejecutarIntento truena (falla de red), se trata igual que un rechazo de Meta, sin propagar la excepción', async () => {
    outbox.ejecutarIntento.mockRejectedValueOnce(new Error('red caída'));
    outbox.ejecutarIntento.mockResolvedValueOnce({ enviado: true, wamid: 'wamid.respaldo' });

    const enviado = await enviarMenuPrincipal({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      claveBase: `grupo:${GROUP_ID}`,
    });

    expect(enviado).toBe(true);
    expect(repository.confirmarMenuEnviado).toHaveBeenCalledWith(CONVERSACION_ID);
  });
});

// US WA 013 — seguimiento y expiración de flujos automáticos. Mismo
// criterio que el describe de WA004: repository/outbox mockeados, aquí se
// prueba la ORQUESTACIÓN (qué clave de idempotencia se arma, qué se llama),
// no el timing real ni la idempotencia real de Postgres (eso vive en
// tests/integration/whatsapp.seguimiento.test.js).
describe('whatsapp.service — seguimiento y expiración de flujos (US WA 013)', () => {
  beforeEach(() => {
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia }, esNuevo: true }),
    );
  });

  it('procesarSiguienteSeguimientoPendiente envía la pregunta con una clave atada al ciclo de inactividad (AC1)', async () => {
    const programadoEn = new Date('2026-01-01T00:00:00.000Z');
    repository.reclamarConversacionParaSeguimiento.mockResolvedValue({
      id: CONVERSACION_ID,
      telefonoNormalizado: '525500000000',
      recordatorioProgramadoEn: programadoEn,
    });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const id = await procesarSiguienteSeguimientoPendiente();

    expect(id).toBe(CONVERSACION_ID);
    expect(outbox.ejecutarIntento).toHaveBeenCalledWith(
      `conversacion:${CONVERSACION_ID}:seguimiento:${programadoEn.getTime()}`,
    );
    const [datos] = outbox.registrarIntento.mock.calls[0];
    expect(datos.payloadFuncional.interactive.type).toBe('button');
  });

  it('procesarSiguienteSeguimientoPendiente no hace nada si no hay ningún candidato', async () => {
    repository.reclamarConversacionParaSeguimiento.mockResolvedValue(null);

    const id = await procesarSiguienteSeguimientoPendiente();

    expect(id).toBeNull();
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
  });

  it('procesarSiguienteSeguimientoPendiente no truena si el envío falla — el cierre por inactividad es la red de seguridad', async () => {
    repository.reclamarConversacionParaSeguimiento.mockResolvedValue({
      id: CONVERSACION_ID,
      telefonoNormalizado: '525500000000',
      recordatorioProgramadoEn: new Date(),
    });
    outbox.ejecutarIntento.mockRejectedValue(new Error('red caída'));

    await expect(procesarSiguienteSeguimientoPendiente()).resolves.toBe(CONVERSACION_ID);
  });

  it('cerrarSiguienteConversacionInactiva delega directo en el repository (AC6)', async () => {
    repository.cerrarConversacionPorInactividad.mockResolvedValue(CONVERSACION_ID);

    const id = await cerrarSiguienteConversacionInactiva();

    expect(id).toBe(CONVERSACION_ID);
    expect(repository.cerrarConversacionPorInactividad).toHaveBeenCalledTimes(1);
  });

  it('reenviarSeguimiento usa una clave atada al mensaje entrante, no al ciclo de inactividad (AC5)', async () => {
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    await reenviarSeguimiento({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      mensajeId: 777,
    });

    expect(outbox.ejecutarIntento).toHaveBeenCalledWith('mensaje:777:seguimiento-invalido');
  });
});

// US WA 014 — agrupación de archivos y respuesta para medios no
// interpretables. Mismo criterio que los describe de WA004/WA013:
// repository/outbox mockeados wholesale, aquí se prueba la LÓGICA de
// decisión — el timing real de agrupación y el marcado no_interpretable_bot
// viven en tests/integration/whatsapp.medios.test.js.
describe('whatsapp.service — medios no interpretables (US WA 014)', () => {
  const GROUP_ID = 900;

  beforeEach(() => {
    repository.reclamarConversacionVencida.mockResolvedValue(CONVERSACION_ID);
    repository.obtenerContextoDeConversacion.mockResolvedValue({
      telefonoNormalizado: '525500000000',
      flujoActual: null,
      pasoActual: null,
      grupoMedioPendienteId: null,
    });
    repository.confirmarGuiaMedioEnviada.mockResolvedValue(true);
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia }, esNuevo: true }),
    );
  });

  it('un grupo sin texto procesable (solo medios) envía la guía y confirma flujo_activo (AC4)', async () => {
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: '',
      tieneTextoProcesable: false,
    });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(outbox.ejecutarIntento).toHaveBeenCalledWith(`grupo:${GROUP_ID}:guia_medio`);
    const [datosIntento] = outbox.registrarIntento.mock.calls[0];
    expect(datosIntento.payloadFuncional.tipo).toBe('text');
    expect(repository.confirmarGuiaMedioEnviada).toHaveBeenCalledWith(CONVERSACION_ID, GROUP_ID);
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'guia_enviada' }));
  });

  it('si Meta rechaza la guía, no confirma flujo_activo y no llama a Claude', async () => {
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: '',
      tieneTextoProcesable: false,
    });
    outbox.ejecutarIntento.mockResolvedValue({
      enviado: false,
      error: 'Número inválido.',
      errorCodigo: '131030',
    });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(repository.confirmarGuiaMedioEnviada).not.toHaveBeenCalled();
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'guia_fallida' }));
  });

  it('resolviendo una explicación pendiente: relaciona los 2 grupos y no reenvía la guía (AC6)', async () => {
    repository.obtenerContextoDeConversacion.mockResolvedValue({
      telefonoNormalizado: '525500000000',
      flujoActual: 'explicacion_medio',
      pasoActual: 'esperando_descripcion',
      grupoMedioPendienteId: 500,
    });
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: 'era una radiografía de mi perro',
      tieneTextoProcesable: true,
    });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(repository.finalizarExplicacionMedio).toHaveBeenCalledWith(
      CONVERSACION_ID,
      GROUP_ID,
      500,
    );
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'explicacion_recibida' }));
  });

  it('esperando explicación pero llegan más medios sin texto: envía otra guía (AC1, no cuenta como explicación)', async () => {
    repository.obtenerContextoDeConversacion.mockResolvedValue({
      telefonoNormalizado: '525500000000',
      flujoActual: 'explicacion_medio',
      pasoActual: 'esperando_descripcion',
      grupoMedioPendienteId: 500,
    });
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: '',
      tieneTextoProcesable: false,
    });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(repository.finalizarExplicacionMedio).not.toHaveBeenCalled();
    expect(repository.confirmarGuiaMedioEnviada).toHaveBeenCalledWith(CONVERSACION_ID, GROUP_ID);
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'guia_enviada' }));
  });
});

// US WA 005 — procesamiento de opciones del menú. Mismo criterio que los
// describe de WA004/WA013/WA014: repository/outbox mockeados, aquí se
// prueba la ORQUESTACIÓN de enviarSeleccionInvalida — la lógica de
// resolución de ruta/detección de selección inválida (repository) y el
// timing real viven en tests/integration/whatsapp.menu-selecciones.test.js.
describe('whatsapp.service — selección de menú inválida (US WA 005 AC9)', () => {
  beforeEach(() => {
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia }, esNuevo: true }),
    );
    repository.confirmarMenuEnviado.mockResolvedValue(true);
  });

  it('envía el texto informativo y un menú nuevo bajo la misma clave base', async () => {
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const enviado = await enviarSeleccionInvalida({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      mensajeId: 321,
    });

    expect(enviado).toBe(true);
    expect(outbox.ejecutarIntento).toHaveBeenCalledWith('mensaje:321:opcion_invalida');
    expect(outbox.ejecutarIntento).toHaveBeenCalledWith('mensaje:321:menu');
    const [datosTexto] = outbox.registrarIntento.mock.calls[0];
    expect(datosTexto.payloadFuncional.tipo).toBe('text');
    expect(repository.confirmarMenuEnviado).toHaveBeenCalledWith(CONVERSACION_ID);
  });

  it('si falla el texto informativo, igual intenta enviar el menú nuevo', async () => {
    outbox.ejecutarIntento
      .mockResolvedValueOnce({ enviado: false, error: 'rechazado', errorCodigo: '1' }) // opcion_invalida
      .mockResolvedValueOnce({ enviado: true, wamid: 'wamid.x' }); // menu

    const enviado = await enviarSeleccionInvalida({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      mensajeId: 321,
    });

    expect(enviado).toBe(true);
    expect(outbox.ejecutarIntento).toHaveBeenCalledTimes(2);
  });
});

// US WA 007 (ampliación, pedido explícito del usuario): al validar el
// folio con éxito, si la orden ya tiene archivos cargados, el bot debe
// adjuntarlos (laboratorioService.reenviarResultadosPorWhatsapp) en vez de
// solo mandar el texto genérico de estado. laboratorio.service está
// mockeado — el armado real de archivos/plantilla se prueba en
// tests/unit/laboratorio.service.test.js y tests/unit/laboratorio.envios.test.js.
describe('whatsapp.service.enviarPasoLaboratorio — adjuntar resultados (US WA 007, ampliación)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('con estadoOrden "cargado" y el adjunto exitoso, NO manda el texto genérico', async () => {
    laboratorioService.reenviarResultadosPorWhatsapp.mockResolvedValue({ ok: true });

    const resultado = await enviarPasoLaboratorio({
      conversacionId: CONVERSACION_ID,
      telefono: '525512345678',
      mensajeId: 321,
      labAccion: 'exito',
      labDatos: { folioId: 5, estadoOrden: 'cargado' },
    });

    expect(resultado).toEqual({ ok: true });
    expect(laboratorioService.reenviarResultadosPorWhatsapp).toHaveBeenCalledWith(5, {
      telefono: '5512345678',
      claveIdempotenciaPrefijo: 'mensaje:321:lab:exito',
    });
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
  });

  it('con estadoOrden "enviado" (ya se había mandado antes) también intenta adjuntar', async () => {
    laboratorioService.reenviarResultadosPorWhatsapp.mockResolvedValue({ ok: true });

    await enviarPasoLaboratorio({
      conversacionId: CONVERSACION_ID,
      telefono: '525512345678',
      mensajeId: 321,
      labAccion: 'exito',
      labDatos: { folioId: 5, estadoOrden: 'enviado' },
    });

    expect(laboratorioService.reenviarResultadosPorWhatsapp).toHaveBeenCalled();
  });

  it('si el adjunto falla, cae al texto genérico de estado (el tutor nunca se queda sin respuesta)', async () => {
    laboratorioService.reenviarResultadosPorWhatsapp.mockResolvedValue({
      ok: false,
      error: 'Meta rechazó el envío.',
    });
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia }, esNuevo: true }),
    );
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const resultado = await enviarPasoLaboratorio({
      conversacionId: CONVERSACION_ID,
      telefono: '525512345678',
      mensajeId: 321,
      labAccion: 'exito',
      labDatos: { folioId: 5, estadoOrden: 'cargado' },
    });

    expect(resultado).toEqual({ enviado: true, wamid: 'wamid.x' });
    const [datosTexto] = outbox.registrarIntento.mock.calls[0];
    expect(datosTexto.payloadFuncional.tipo).toBe('text');
  });

  it('con estadoOrden "pendiente" nunca intenta adjuntar (no hay archivos que enviar)', async () => {
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia }, esNuevo: true }),
    );
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    await enviarPasoLaboratorio({
      conversacionId: CONVERSACION_ID,
      telefono: '525512345678',
      mensajeId: 321,
      labAccion: 'exito',
      labDatos: { folioId: 5, estadoOrden: 'pendiente' },
    });

    expect(laboratorioService.reenviarResultadosPorWhatsapp).not.toHaveBeenCalled();
  });
});
