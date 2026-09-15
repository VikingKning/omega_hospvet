jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
jest.mock('../../src/modules/whatsapp/whatsapp.repository');
jest.mock('../../src/modules/whatsapp/whatsapp.outbox');
jest.mock('../../src/modules/whatsapp/whatsapp.atencionHumana.service');
jest.mock('../../src/modules/whatsapp/whatsapp.emergenciasAlertas.service');
jest.mock('../../src/modules/laboratorio/laboratorio.service');
jest.mock('../../src/config/database');

const claude = require('../../src/config/claude');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const plantillasRepository = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');
const atencionHumanaService = require('../../src/modules/whatsapp/whatsapp.atencionHumana.service');
const emergenciasAlertasService = require('../../src/modules/whatsapp/whatsapp.emergenciasAlertas.service');
const laboratorioService = require('../../src/modules/laboratorio/laboratorio.service');
const {
  registrarEventoEntrante,
  procesarSiguienteConversacionVencida,
  enviarMenuPrincipal,
  enviarEnlaceAgenda,
  procesarSiguienteSeguimientoPendiente,
  cerrarSiguienteConversacionInactiva,
  reenviarSeguimiento,
  enviarSeleccionInvalida,
  enviarPasoLaboratorio,
  enviarSolicitudEmergencia,
  clasificarYResponderGrupo,
} = require('../../src/modules/whatsapp/whatsapp.service');

const MENSAJE_ID = 42;
const CONVERSACION_ID = 55;

beforeEach(() => {
  jest.clearAllMocks();
  db.transaction = jest.fn((cb) => cb('trx-fake'));
  repository.registrarMensajeYConversacion.mockResolvedValue({ id: MENSAJE_ID, esNuevo: true });
});

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
    expect(atencionHumanaService.solicitarAtencionHumana).not.toHaveBeenCalled();
  });

  it('US WA 010: la ruta recepcion delega a WA017 con origen, prioridad y correlación controlados', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    repository.registrarMensajeYConversacion.mockResolvedValue({
      id: 8,
      esNuevo: true,
      conversacionId: 55,
      rutaResuelta: 'recepcion',
      groupId: 77,
    });
    atencionHumanaService.solicitarAtencionHumana.mockResolvedValue({ id: 99 });

    await registrarEventoEntrante({
      whatsappMessageId: 'wamid.recepcion-1',
      from: '5215500000000',
      phoneNumberId: 'phone-1',
      timestamp: '1700000000',
      tipoMensaje: 'interactive_list_reply',
      contenido: 'MENU_RECEPCION',
      mediaId: null,
    });

    expect(atencionHumanaService.solicitarAtencionHumana).toHaveBeenCalledWith({
      conversacionId: 55,
      origen: 'recepcion',
      prioridad: 'normal',
      origenAlerta: 'menu_recepcion',
      claveIdempotencia: 'recepcion:mensaje:wamid.recepcion-1',
      referenciasFuncionales: {
        groupId: 77,
        mensajeOrigenId: 8,
        whatsappMessageId: 'wamid.recepcion-1',
      },
      destinatarioTelefono: '525500000000',
    });
    expect(spyClasificar).not.toHaveBeenCalled();
    spyClasificar.mockRestore();
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

// US WA 009 — conecta finalmente el grupo consolidado con
// claude.clasificarMensaje. repository/outbox/plantillasRepository/
// atencionHumanaService mockeados wholesale: aquí se prueba la
// ORQUESTACIÓN (qué se persiste, en qué orden, cuándo se llama a Claude);
// el timing real de las ventanas de agrupación y la idempotencia real de
// Postgres viven en tests/integration/whatsapp.agrupacion.test.js.
describe('whatsapp.service.clasificarYResponderGrupo (US WA 009)', () => {
  const GROUP_ID = 700;
  const TELEFONO = '525500000000';
  const PLANTILLA_CATALOGO = {
    id: 1,
    slug: 'dosis-olvidada',
    intencion: 'dosis_olvidada',
    activo: true,
    es_emergencia: false,
    texto_respuesta: 'Respuesta de dosis_olvidada.',
  };
  const PLANTILLA_EMERGENCIA = {
    id: 100,
    slug: 'emergencia-medica',
    activo: true,
    es_emergencia: true,
    texto_respuesta: 'Texto de emergencia predeterminado.',
  };
  const PLANTILLA_SIN_COINCIDENCIA = {
    id: 101,
    slug: 'sin-coincidencia-default',
    intencion: 'sin_coincidencia_default',
    activo: true,
    es_emergencia: false,
    texto_respuesta: 'Respuesta general controlada.',
  };

  function mockClasificarMensaje(etiqueta, { tokensEntrada = 12, tokensSalida = 3 } = {}) {
    claude.clasificarMensaje = jest
      .fn()
      .mockResolvedValue({ etiqueta, tokensEntrada, tokensSalida });
  }

  beforeEach(() => {
    repository.obtenerClasificacionGrupo.mockResolvedValue({ clasificado_en: null });
    repository.reclamarClasificacionGrupo.mockResolvedValue({ group_id: GROUP_ID });
    repository.incorporarFragmentosTardiosAlGrupo.mockResolvedValue(false);
    repository.persistirClasificacionGrupo.mockResolvedValue({ group_id: GROUP_ID });
    plantillasRepository.findActivasParaClasificar.mockResolvedValue([PLANTILLA_CATALOGO]);
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { intent_id: 900, clave_idempotencia: datos.claveIdempotencia } }),
    );
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });
    repository.insertarEmergenciaConfirmada.mockResolvedValue({ id: 55 });
    emergenciasAlertasService.registrarDesdeEmergenciaConfirmada.mockResolvedValue({
      alerta: { id: 88 },
      esNueva: true,
    });
    atencionHumanaService.solicitarAtencionHumana.mockResolvedValue({ id: 1 });
  });

  it('AC11/AC21: Claude solo nombra el slug — nunca decide es_emergencia ni redacta la respuesta', async () => {
    mockClasificarMensaje('dosis-olvidada');
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_CATALOGO);

    await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'se me olvidó la pastilla',
      telefono: TELEFONO,
    });

    expect(claude.clasificarMensaje).toHaveBeenCalledWith(
      'se me olvidó la pastilla',
      [PLANTILLA_CATALOGO],
      expect.objectContaining({
        emergencia: 'emergencia-medica',
        agendar_cita: 'agendar-cita-default',
        resultados_laboratorio: 'resultados-laboratorio-default',
        duda_medica: 'sin-coincidencia-default',
      }),
    );
  });

  it('es_emergencia=false: persiste la clasificación, envía la respuesta y cierra la conversación, sin atención humana (AC15)', async () => {
    mockClasificarMensaje('dosis-olvidada', { tokensEntrada: 15, tokensSalida: 3 });
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_CATALOGO);

    const resultado = await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'se me olvidó la pastilla',
      telefono: TELEFONO,
    });

    expect(plantillasRepository.incrementarUso).toHaveBeenCalledWith(1, 'trx-fake');
    expect(repository.persistirClasificacionGrupo).toHaveBeenCalledWith(
      'trx-fake',
      GROUP_ID,
      expect.objectContaining({
        plantillaId: 1,
        slugResuelto: 'dosis-olvidada',
        esEmergencia: false,
        respuestaDefinitiva: 'Respuesta de dosis_olvidada.',
        tokensEntrada: 15,
        tokensSalida: 3,
        rutaEnrutamiento: 'consulta_libre',
        categoriaResuelta: 'duda_medica',
        intencionResuelta: 'dosis_olvidada',
        resultadoDecision: 'plantilla',
        etiquetaModelo: 'dosis-olvidada',
      }),
    );
    expect(outbox.ejecutarIntento).toHaveBeenCalledWith(`grupo:${GROUP_ID}:respuesta`);
    expect(repository.persistirClasificacionGrupo.mock.invocationCallOrder[0]).toBeLessThan(
      outbox.ejecutarIntento.mock.invocationCallOrder[0],
    );
    expect(repository.marcarGrupoProcesado).toHaveBeenCalledWith(GROUP_ID);
    expect(repository.finalizarConversacionTrasGrupo).toHaveBeenCalledWith(
      CONVERSACION_ID,
      expect.any(Date),
    );
    expect(repository.insertarEmergenciaConfirmada).not.toHaveBeenCalled();
    expect(emergenciasAlertasService.registrarDesdeEmergenciaConfirmada).not.toHaveBeenCalled();
    expect(atencionHumanaService.solicitarAtencionHumana).not.toHaveBeenCalled();
    expect(resultado).toBe('clasificado_normal');
  });

  it('es_emergencia=true: persiste, envía, NO cierra la conversación y solicita atención humana con origen/prioridad/clave correctos (AC13/AC14)', async () => {
    mockClasificarMensaje('emergencia-medica');
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_EMERGENCIA);

    const resultado = await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'mi perro no respira',
      telefono: TELEFONO,
    });

    expect(repository.insertarEmergenciaConfirmada).toHaveBeenCalledWith(
      'trx-fake',
      expect.objectContaining({
        conversacionId: CONVERSACION_ID,
        groupId: GROUP_ID,
        plantillaId: 100,
        slug: 'emergencia-medica',
      }),
    );
    expect(emergenciasAlertasService.registrarDesdeEmergenciaConfirmada).toHaveBeenCalledWith({
      emergenciaConfirmada: { id: 55 },
      telefonoExterno: TELEFONO,
      trx: 'trx-fake',
    });
    expect(atencionHumanaService.solicitarAtencionHumana).toHaveBeenCalledWith(
      expect.objectContaining({
        conversacionId: CONVERSACION_ID,
        origen: 'emergencia',
        prioridad: 'critica',
        claveIdempotencia: `emergencia:grupo:${GROUP_ID}`,
        envioPrevioId: 900,
        destinatarioTelefono: TELEFONO,
        registrarAlerta: false,
        trx: 'trx-fake',
        referenciasFuncionales: expect.objectContaining({
          groupId: GROUP_ID,
          plantillaId: 100,
          slug: 'emergencia-medica',
          emergenciaConfirmadaId: 55,
        }),
      }),
    );
    expect(repository.finalizarConversacionTrasGrupo).not.toHaveBeenCalled();
    expect(resultado).toBe('clasificado_emergencia');
  });

  it('AC18: slug sin plantilla activa/utilizable — respaldo general, es_emergencia=false, sin atención humana', async () => {
    mockClasificarMensaje('slug-inexistente');
    plantillasRepository.findBySlug
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(PLANTILLA_SIN_COINCIDENCIA);

    await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'algo ambiguo',
      telefono: TELEFONO,
    });

    expect(repository.persistirClasificacionGrupo).toHaveBeenCalledWith(
      'trx-fake',
      GROUP_ID,
      expect.objectContaining({
        plantillaId: 101,
        slugResuelto: 'sin-coincidencia-default',
        esEmergencia: false,
        respuestaDefinitiva: 'Respuesta general controlada.',
        resultadoDecision: 'plantilla_respaldo',
      }),
    );
    expect(atencionHumanaService.solicitarAtencionHumana).not.toHaveBeenCalled();
    expect(emergenciasAlertasService.registrarDesdeEmergenciaConfirmada).not.toHaveBeenCalled();
  });

  it('AC18: Claude no encajó ninguna etiqueta (slug null) — mismo respaldo general', async () => {
    mockClasificarMensaje(null);
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_SIN_COINCIDENCIA);

    await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'texto ambiguo',
      telefono: TELEFONO,
    });

    expect(plantillasRepository.findBySlug).toHaveBeenCalledTimes(1);
    expect(plantillasRepository.findBySlug).toHaveBeenCalledWith('sin-coincidencia-default');
    expect(repository.persistirClasificacionGrupo).toHaveBeenCalledWith(
      'trx-fake',
      GROUP_ID,
      expect.objectContaining({
        plantillaId: 101,
        slugResuelto: 'sin-coincidencia-default',
        categoriaResuelta: 'sin_coincidencia',
        intencionResuelta: 'sin_coincidencia_default',
        resultadoDecision: 'plantilla_respaldo',
        etiquetaModelo: null,
        esEmergencia: false,
      }),
    );
  });

  it('WA011 AC19: un fallo de Claude persiste sin_coincidencia_default y no libera el lease para reclasificar', async () => {
    claude.clasificarMensaje = jest.fn().mockRejectedValue(
      Object.assign(new Error('timeout controlado'), {
        code: 'CLAUDE_TIMEOUT',
      }),
    );
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_SIN_COINCIDENCIA);

    const resultado = await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'consulta que no debe aparecer en logs',
      telefono: TELEFONO,
    });

    expect(resultado).toBe('clasificado_normal');
    expect(repository.liberarClasificacionGrupo).not.toHaveBeenCalled();
    expect(repository.persistirClasificacionGrupo).toHaveBeenCalledWith(
      'trx-fake',
      GROUP_ID,
      expect.objectContaining({
        slugResuelto: 'sin-coincidencia-default',
        tokensEntrada: 0,
        tokensSalida: 0,
        resultadoDecision: 'plantilla_respaldo',
      }),
    );
  });

  it('WA011 AC19: Claude no configurado usa el mismo fallback sin reintentar fragmentos', async () => {
    claude.clasificarMensaje = jest
      .fn()
      .mockRejectedValue(new Error('El clasificador de Claude no está configurado.'));
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_SIN_COINCIDENCIA);

    await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'consulta libre',
      telefono: TELEFONO,
    });

    expect(claude.clasificarMensaje).toHaveBeenCalledTimes(1);
    expect(repository.persistirClasificacionGrupo).toHaveBeenCalledWith(
      'trx-fake',
      GROUP_ID,
      expect.objectContaining({
        slugResuelto: 'sin-coincidencia-default',
        tokensEntrada: 0,
        tokensSalida: 0,
      }),
    );
    expect(repository.liberarClasificacionGrupo).not.toHaveBeenCalled();
  });

  it('si llega otro fragmento durante Claude, reprograma el grupo y no envía el respaldo parcial', async () => {
    mockClasificarMensaje(null);
    repository.incorporarFragmentosTardiosAlGrupo.mockResolvedValue(true);

    const resultado = await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'hola, tengo un problema',
      telefono: TELEFONO,
    });

    expect(resultado).toBe('grupo_reprogramado');
    expect(repository.persistirClasificacionGrupo).not.toHaveBeenCalled();
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
    expect(outbox.ejecutarIntento).not.toHaveBeenCalled();
  });

  it('AC20: plantilla es_emergencia=true pero sin contenido recuperable — conserva la emergencia y usa el respaldo con el contacto oficial', async () => {
    mockClasificarMensaje('emergencia-medica');
    plantillasRepository.findBySlug.mockResolvedValue({
      ...PLANTILLA_EMERGENCIA,
      texto_respuesta: '',
    });

    await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'mi perro no respira',
      telefono: TELEFONO,
    });

    expect(repository.persistirClasificacionGrupo).toHaveBeenCalledWith(
      'trx-fake',
      GROUP_ID,
      expect.objectContaining({
        esEmergencia: true,
        respuestaDefinitiva: expect.stringContaining('7711634578'),
      }),
    );
    expect(atencionHumanaService.solicitarAtencionHumana).toHaveBeenCalled();
  });

  it('AC26/AC27: un grupo YA clasificado nunca vuelve a llamar a Claude ni a crear otra solicitud — solo reintenta el envío', async () => {
    repository.obtenerClasificacionGrupo.mockResolvedValue({
      plantilla_id: 100,
      slug_resuelto: 'emergencia-medica',
      es_emergencia_resuelta: true,
      respuesta_definitiva: 'Texto de emergencia predeterminado.',
      clasificado_en: new Date('2026-01-01T00:00:00Z'),
      intento_envio_id: 900,
    });

    const resultado = await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'mi perro no respira',
      telefono: TELEFONO,
    });

    expect(claude.clasificarMensaje).not.toHaveBeenCalled();
    expect(repository.persistirClasificacionGrupo).not.toHaveBeenCalled();
    expect(atencionHumanaService.solicitarAtencionHumana).not.toHaveBeenCalled();
    expect(emergenciasAlertasService.registrarDesdeEmergenciaConfirmada).not.toHaveBeenCalled();
    expect(outbox.ejecutarIntento).toHaveBeenCalledWith(`grupo:${GROUP_ID}:respuesta`);
    expect(resultado).toBe('clasificado_emergencia');
  });

  it('si Meta rechaza el envío, no marca el grupo procesado ni cierra la conversación (permite reintento)', async () => {
    mockClasificarMensaje('dosis-olvidada');
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_CATALOGO);
    outbox.ejecutarIntento.mockResolvedValue({
      enviado: false,
      error: 'rechazado',
      errorCodigo: '131009',
    });

    const resultado = await clasificarYResponderGrupo({
      conversacionId: CONVERSACION_ID,
      groupId: GROUP_ID,
      textoConsolidado: 'se me olvidó la pastilla',
      telefono: TELEFONO,
    });

    expect(repository.marcarGrupoProcesado).not.toHaveBeenCalled();
    expect(repository.finalizarConversacionTrasGrupo).not.toHaveBeenCalled();
    expect(resultado).toBe('clasificado_fallo_envio');
  });

  it('si ejecutarIntento truena, se trata igual que un rechazo de Meta, sin propagar la excepción', async () => {
    mockClasificarMensaje('dosis-olvidada');
    plantillasRepository.findBySlug.mockResolvedValue(PLANTILLA_CATALOGO);
    outbox.ejecutarIntento.mockRejectedValue(new Error('red caída'));

    await expect(
      clasificarYResponderGrupo({
        conversacionId: CONVERSACION_ID,
        groupId: GROUP_ID,
        textoConsolidado: 'se me olvidó la pastilla',
        telefono: TELEFONO,
      }),
    ).resolves.toBe('clasificado_fallo_envio');
  });
});

// US WA 009 (AC1-AC3) — envía "Por favor, descríbenos cuál es tu
// emergencia." tras seleccionar MENU_EMERGENCIA. Mismo criterio que
// enviarMenuPrincipal/enviarGuiaMedioNoInterpretable: outbox mockeado, se
// prueba la orquestación de confirmación-solo-si-hubo-éxito.
describe('whatsapp.service.enviarSolicitudEmergencia (US WA 009 AC1-AC3)', () => {
  beforeEach(() => {
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia } }),
    );
  });

  it('envío exitoso confirma la transición a flujo_activo/emergencia/esperando_descripcion (AC2)', async () => {
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });
    repository.confirmarEmergenciaSolicitada.mockResolvedValue(true);

    const resultado = await enviarSolicitudEmergencia({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      claveBase: 'mensaje:1',
    });

    expect(outbox.ejecutarIntento).toHaveBeenCalledWith('mensaje:1:emergencia_solicitud');
    expect(repository.confirmarEmergenciaSolicitada).toHaveBeenCalledWith(CONVERSACION_ID);
    expect(resultado).toBe(true);
  });

  it('envío fallido NO confirma la transición (AC3)', async () => {
    outbox.ejecutarIntento.mockResolvedValue({
      enviado: false,
      error: 'rechazado',
      errorCodigo: '131009',
    });

    const resultado = await enviarSolicitudEmergencia({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      claveBase: 'mensaje:1',
    });

    expect(repository.confirmarEmergenciaSolicitada).not.toHaveBeenCalled();
    expect(resultado).toBe(false);
  });

  it('si ejecutarIntento truena, se trata igual que un rechazo de Meta, sin propagar la excepción', async () => {
    outbox.ejecutarIntento.mockRejectedValue(new Error('red caída'));

    await expect(
      enviarSolicitudEmergencia({
        conversacionId: CONVERSACION_ID,
        telefono: '525500000000',
        claveBase: 'mensaje:1',
      }),
    ).resolves.toBe(false);
    expect(repository.confirmarEmergenciaSolicitada).not.toHaveBeenCalled();
  });
});

describe('whatsapp.service.enviarEnlaceAgenda (US WA 006)', () => {
  const consultaOriginal = env.enlaces.calendarioCitas;
  const esteticaOriginal = env.enlaces.calendarioEstetica;

  beforeEach(() => {
    env.enlaces.calendarioCitas = 'https://calendar.example/consulta';
    env.enlaces.calendarioEstetica = 'https://calendar.example/estetica';
    outbox.registrarIntento.mockImplementation((datos) =>
      Promise.resolve({ intent: { clave_idempotencia: datos.claveIdempotencia } }),
    );
  });

  afterAll(() => {
    env.enlaces.calendarioCitas = consultaOriginal;
    env.enlaces.calendarioEstetica = esteticaOriginal;
  });

  it.each([
    ['agendar_consulta', 'Consulta', 'https://calendar.example/consulta'],
    ['agendar_estetica', 'Estética', 'https://calendar.example/estetica'],
  ])(
    'envía el enlace HTTPS de %s y cierra solo tras confirmación de Meta',
    async (ruta, tipo, url) => {
      const spyClaude = jest.spyOn(claude, 'clasificarMensaje');
      outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.agenda' });
      repository.confirmarEnlaceAgendaEnviado.mockResolvedValue(true);

      const resultado = await enviarEnlaceAgenda({
        conversacionId: CONVERSACION_ID,
        telefono: '525500000000',
        claveBase: 'mensaje:123',
        ruta,
      });

      expect(outbox.registrarIntento).toHaveBeenCalledWith(
        expect.objectContaining({
          claveIdempotencia: `mensaje:123:${ruta}:enlace`,
          tipoEnvio: 'conversacional',
          origenFuncional: 'respuesta_automatica',
          payloadFuncional: {
            tipo: 'text',
            destinatarioTelefono: '525500000000',
            texto: `Agenda tu cita de ${tipo} en el calendario de Omega:\n${url}`,
          },
        }),
      );
      expect(repository.confirmarEnlaceAgendaEnviado).toHaveBeenCalledWith(
        CONVERSACION_ID,
        expect.any(Date),
      );
      expect(resultado).toEqual(
        expect.objectContaining({ enviado: true, conversacionCerrada: true }),
      );
      expect(spyClaude).not.toHaveBeenCalled();
      spyClaude.mockRestore();
    },
  );

  it.each([
    ['agendar_consulta', undefined, 'agenda_consulta_sin_enlace', 'configuracion_ausente'],
    [
      'agendar_estetica',
      'http://calendar.example/estetica',
      'agenda_estetica_sin_enlace',
      'configuracion_invalida',
    ],
  ])(
    'sin URL HTTPS válida para %s transfiere a Recepción sin enviar el enlace',
    async (ruta, valor, tipoAviso, motivo) => {
      if (ruta === 'agendar_consulta') env.enlaces.calendarioCitas = valor;
      else env.enlaces.calendarioEstetica = valor;

      const resultado = await enviarEnlaceAgenda({
        conversacionId: CONVERSACION_ID,
        telefono: '525500000000',
        claveBase: 'mensaje:124',
        ruta,
      });

      expect(atencionHumanaService.solicitarAtencionHumana).toHaveBeenCalledWith({
        conversacionId: CONVERSACION_ID,
        origen: 'recepcion',
        prioridad: 'normal',
        claveIdempotencia: `mensaje:124:${ruta}:recepcion`,
        referenciasFuncionales: { ruta, motivo },
        destinatarioTelefono: '525500000000',
        tipoAviso,
      });
      expect(outbox.registrarIntento).not.toHaveBeenCalled();
      expect(repository.confirmarEnlaceAgendaEnviado).not.toHaveBeenCalled();
      expect(resultado).toEqual({ enviado: false, transferidaARecepcion: true });
    },
  );

  it('si falla el envío conserva el intento y no cierra la conversación', async () => {
    outbox.ejecutarIntento.mockResolvedValue({ enviado: false, error: 'Meta rechazó' });

    const resultado = await enviarEnlaceAgenda({
      conversacionId: CONVERSACION_ID,
      telefono: '525500000000',
      claveBase: 'mensaje:125',
      ruta: 'agendar_consulta',
    });

    expect(outbox.registrarIntento).toHaveBeenCalledTimes(1);
    expect(repository.confirmarEnlaceAgendaEnviado).not.toHaveBeenCalled();
    expect(resultado).toEqual(
      expect.objectContaining({ enviado: false, conversacionCerrada: false }),
    );
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
    expect(repository.persistirDecisionDeterministaGrupo).toHaveBeenCalledWith(
      'trx-fake',
      GROUP_ID,
      {
        rutaEnrutamiento: 'saludo_puro',
        intencionResuelta: 'mostrar_menu_principal',
        resultadoDecision: 'menu_principal',
        respuestaDefinitiva: expect.any(String),
      },
    );
    expect(repository.persistirDecisionDeterministaGrupo.mock.invocationCallOrder[0]).toBeLessThan(
      outbox.ejecutarIntento.mock.invocationCallOrder[0],
    );
    expect(repository.confirmarMenuEnviado).toHaveBeenCalledWith(CONVERSACION_ID, GROUP_ID);
    expect(resultado).toEqual(
      expect.objectContaining({ groupId: GROUP_ID, resultado: 'menu_enviado' }),
    );
  });

  it('un grupo con texto normal (ni saludo ni comando) se clasifica con Claude, ya no queda sin resolver (US WA 009, antes AC3/AC4 de WA004)', async () => {
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: 'mi perro no come',
      tieneTextoProcesable: true,
    });
    repository.obtenerClasificacionGrupo.mockResolvedValue({ clasificado_en: null });
    plantillasRepository.findActivasParaClasificar.mockResolvedValue([]);
    claude.clasificarMensaje = jest
      .fn()
      .mockResolvedValue({ etiqueta: null, tokensEntrada: 5, tokensSalida: 1 });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(claude.clasificarMensaje).toHaveBeenCalledWith(
      'mi perro no come',
      [],
      expect.any(Object),
    );
    expect(repository.confirmarMenuEnviado).not.toHaveBeenCalled();
    expect(repository.finalizarConversacionTrasGrupo).toHaveBeenCalledWith(
      CONVERSACION_ID,
      expect.any(Date),
    );
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'clasificado_normal' }));
  });

  it('un grupo formado mientras se espera la descripción de una emergencia se clasifica SIEMPRE, sin el filtro de saludo/comando (US WA 009 AC6)', async () => {
    repository.obtenerContextoDeConversacion.mockResolvedValue({
      telefonoNormalizado: '525500000000',
      flujoActual: 'emergencia',
      pasoActual: 'esperando_descripcion',
      grupoMedioPendienteId: null,
    });
    repository.formarGrupoParaConversacion.mockResolvedValue({
      groupId: GROUP_ID,
      reutilizado: false,
      texto_consolidado: 'hola', // AC6: un saludo puro NO debe disparar el menú aquí.
      tieneTextoProcesable: true,
    });
    repository.obtenerClasificacionGrupo.mockResolvedValue({ clasificado_en: null });
    plantillasRepository.findActivasParaClasificar.mockResolvedValue([]);
    claude.clasificarMensaje = jest
      .fn()
      .mockResolvedValue({ etiqueta: null, tokensEntrada: 5, tokensSalida: 1 });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.x' });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(repository.confirmarMenuEnviado).not.toHaveBeenCalled();
    expect(claude.clasificarMensaje).toHaveBeenCalled();
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'clasificado_normal' }));
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
    expect(repository.confirmarSeguimientoEnviado).toHaveBeenCalledWith(CONVERSACION_ID);
  });

  it('procesarSiguienteSeguimientoPendiente no hace nada si no hay ningún candidato', async () => {
    repository.reclamarConversacionParaSeguimiento.mockResolvedValue(null);

    const id = await procesarSiguienteSeguimientoPendiente();

    expect(id).toBeNull();
    expect(outbox.registrarIntento).not.toHaveBeenCalled();
  });

  it('si el envío falla libera el lease y no confirma el recordatorio', async () => {
    repository.reclamarConversacionParaSeguimiento.mockResolvedValue({
      id: CONVERSACION_ID,
      telefonoNormalizado: '525500000000',
      recordatorioProgramadoEn: new Date(),
    });
    outbox.ejecutarIntento.mockRejectedValue(new Error('red caída'));

    await expect(procesarSiguienteSeguimientoPendiente()).resolves.toBe(CONVERSACION_ID);
    expect(repository.liberarSeguimiento).toHaveBeenCalledWith(CONVERSACION_ID);
    expect(repository.confirmarSeguimientoEnviado).not.toHaveBeenCalled();
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
    repository.obtenerClasificacionGrupo.mockResolvedValue({ clasificado_en: null });
    repository.reclamarClasificacionGrupo.mockResolvedValue({ group_id: GROUP_ID });
    repository.persistirClasificacionGrupo.mockResolvedValue({ group_id: GROUP_ID });
    plantillasRepository.findActivasParaClasificar.mockResolvedValue([]);
    claude.clasificarMensaje = jest
      .fn()
      .mockResolvedValue({ etiqueta: null, tokensEntrada: 5, tokensSalida: 1 });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.respuesta' });

    const resultado = await procesarSiguienteConversacionVencida();

    expect(repository.finalizarExplicacionMedio).toHaveBeenCalledWith(
      CONVERSACION_ID,
      GROUP_ID,
      500,
    );
    expect(outbox.registrarIntento).toHaveBeenCalledWith(
      expect.objectContaining({ claveIdempotencia: 'grupo:900:respuesta' }),
      'trx-fake',
    );
    expect(claude.clasificarMensaje).toHaveBeenCalled();
    expect(resultado).toEqual(expect.objectContaining({ resultado: 'clasificado_normal' }));
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
