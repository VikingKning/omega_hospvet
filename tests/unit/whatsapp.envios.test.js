// Envíos de laboratorio: subida de archivos, plantilla fuera de ventana y
// documentos/imágenes dentro de la ventana de atención. Meta se simula;
// los rechazos llegan al servicio de laboratorio como errores con diagnóstico.
const whatsappConfig = require('../../src/config/whatsapp');
jest.mock('../../src/modules/whatsapp/whatsapp.repository');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const {
  subirMedia,
  enviarPlantillaResultados,
  enviarResultadoLaboratorio,
} = require('../../src/modules/whatsapp/whatsapp.envios');

const originalFetch = global.fetch;

// US WA 015: enviarPlantillaResultados ahora pasa por whatsapp.outbox.js,
// que a su vez llama al repository (mockeado wholesale arriba) — este fake
// en memoria imita lo mínimo que outbox.ejecutarIntento necesita para que
// el body de fetch/las aserciones de auditoría existentes sigan siendo
// exactamente las mismas de antes.
let intents;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  jest.spyOn(whatsappConfig, 'mediaUrl').mockReturnValue('https://graph.facebook.com/fake/media');
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'bearerHeader').mockReturnValue({ Authorization: 'Bearer fake' });
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });

  intents = new Map();
  repository.buscarVentanaServicioCliente.mockResolvedValue(null);
  repository.registrarIntentoEnvio.mockImplementation(async (datos) => {
    if (intents.has(datos.claveIdempotencia)) {
      return { intent: intents.get(datos.claveIdempotencia), esNuevo: false };
    }
    // Shape en snake_case, igual que una fila real de outbox_whatsapp —
    // whatsapp.outbox.js lee intent.payload_funcional/intent.tipo_envio/etc.
    const intent = {
      intent_id: intents.size + 1,
      clave_idempotencia: datos.claveIdempotencia,
      tipo_envio: datos.tipoEnvio,
      origen_funcional: datos.origenFuncional,
      conversacion_id: datos.conversacionId ?? null,
      destinatario_telefono: datos.destinatarioTelefono,
      payload_funcional: datos.payloadFuncional,
      wamid: null,
      estado: 'pendiente',
    };
    intents.set(datos.claveIdempotencia, intent);
    return { intent, esNuevo: true };
  });
  repository.buscarIntentoPorClave.mockImplementation(async (clave) => intents.get(clave));
  repository.reclamarIntentoEnvio.mockImplementation(async (clave) => ({
    intent: intents.get(clave),
    reclamado: true,
  }));
  repository.incrementarIntento.mockResolvedValue();
  repository.marcarWamid.mockImplementation(async (id, wamid) => {
    for (const intent of intents.values()) if (intent.intent_id === id) intent.wamid = wamid;
  });
  repository.marcarResultadoEnvio.mockImplementation(async (id, { estado }) => {
    for (const intent of intents.values()) if (intent.intent_id === id) intent.estado = estado;
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('whatsapp.envios.subirMedia', () => {
  it('sube el archivo vía multipart (FormData) y regresa el media id', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'media-123' }) });

    const id = await subirMedia(Buffer.from('contenido'), 'application/pdf', 'resultados.pdf');

    expect(id).toBe('media-123');
    const [url, opciones] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/fake/media');
    expect(opciones.method).toBe('POST');
    expect(opciones.headers).toEqual({ Authorization: 'Bearer fake' });
    expect(opciones.body).toBeInstanceOf(FormData);
  });

  it('si Meta responde sin ok, lanza con el mensaje de error de Meta', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'Tipo de archivo no soportado.' } }),
    });

    await expect(subirMedia(Buffer.from('x'), 'application/pdf', 'resultados.pdf')).rejects.toThrow(
      'Tipo de archivo no soportado.',
    );
  });

  it('si Meta responde ok pero sin id (forma inesperada), también lanza', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await expect(subirMedia(Buffer.from('x'), 'application/pdf', 'resultados.pdf')).rejects.toThrow(
      /HTTP 200/,
    );
  });

  it('conserva codigo, subcodigo y estado HTTP cuando falla la subida', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 100,
          error_subcode: 33,
          fbtrace_id: 'trace-de-prueba',
          message: 'Archivo invalido',
          error_data: { details: 'No se pudo procesar el archivo' },
        },
      }),
    });
    await expect(
      subirMedia(Buffer.from('x'), 'application/pdf', 'aviso.pdf'),
    ).rejects.toMatchObject({
      diagnosticoMeta: {
        codigo: 100,
        subcodigo: 33,
        httpStatus: 400,
        referenciaMeta: 'trace-de-prueba',
        detalle: 'No se pudo procesar el archivo',
      },
    });
  });
});

describe('whatsapp.envios.enviarPlantillaResultados', () => {
  it('manda la plantilla v2 con el encabezado de documento y las 6 variables del cuerpo', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await enviarPlantillaResultados({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      folio: '005',
      calendarUrl: 'https://calendar.example/agendar',
      mapsUrl: 'https://maps.example/ubicacion',
      saludo: 'tarde',
      mediaId: 'media-123',
      nombreArchivo: 'resultados.pdf',
      claveIdempotencia: 'laboratorio:1:1',
    });

    const [url, opciones] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/fake/messages');
    const body = JSON.parse(opciones.body);
    // Bug real encontrado en vivo: propietarios.telefono se guarda como 10
    // dígitos SIN código de país (tutores.service.js#stripTelefono) —
    // mandarlo tal cual a Meta daba "(#131030) Recipient phone number not
    // in allowed list" aunque el número SÍ estuviera en la lista de
    // prueba, porque Meta no lo reconocía sin el "52" al frente.
    expect(body.to).toBe('525512345678');
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('resultados_laboratorio_listos_v2');
    expect(body.template.components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { id: 'media-123', filename: 'resultados.pdf' } }],
    });
    expect(body.template.components[1]).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Ana Ruiz' },
        { type: 'text', text: 'Firulais' },
        { type: 'text', text: '005' },
        { type: 'text', text: 'https://calendar.example/agendar' },
        { type: 'text', text: 'https://maps.example/ubicacion' },
        { type: 'text', text: 'tarde' },
      ],
    });
    expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        plantilla: 'resultados_laboratorio_listos_v2',
        destinatarioTelefono: '525512345678',
        exitoso: true,
        origen: 'laboratorio',
      }),
    );
    // US WA 002 AC13: un envío proactivo nunca activa atención humana ni
    // toca ninguna conversación.
    expect(repository.registrarMensajeYConversacion).not.toHaveBeenCalled();
    expect(repository.cerrarConversacion).not.toHaveBeenCalled();
  });

  it('si Meta rechaza el envío, lanza con el mensaje de error de Meta', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'La plantilla no está aprobada todavía.' } }),
    });

    await expect(
      enviarPlantillaResultados({
        telefono: '5512345678',
        nombreTutor: 'Ana',
        nombreMascota: 'Firulais',
        folio: '005',
        calendarUrl: 'https://calendar.example/agendar',
        mapsUrl: 'https://maps.example/ubicacion',
        saludo: 'tarde',
        mediaId: 'media-123',
        nombreArchivo: 'resultados.pdf',
        claveIdempotencia: 'laboratorio:2:2',
      }),
    ).rejects.toThrow('La plantilla no está aprobada todavía.');
    expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        exitoso: false,
        errorMensaje: 'La plantilla no está aprobada todavía.',
      }),
    );
  });
});

describe('enviarResultadoLaboratorio: ventana real del cliente', () => {
  const datos = {
    telefono: '5512345678',
    nombreTutor: 'Ana',
    nombreMascota: 'Firulais',
    folio: '005',
    calendarUrl: 'https://example.com/citas',
    mapsUrl: 'https://example.com/mapa',
    saludo: 'tarde',
    mediaId: 'media-123',
    nombreArchivo: 'Resultado_Omega_01.pdf',
    claveIdempotencia: 'laboratorio:ventana:1',
  };
  beforeEach(() => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.lab' }] }),
    });
  });

  it.each(['5512345678', '+52 55 1234 5678', '5215512345678'])(
    'envía documento sin plantilla dentro de 24 horas y normaliza %s',
    async (telefono) => {
      repository.buscarVentanaServicioCliente.mockResolvedValue({ conversacionId: 9 });
      await enviarResultadoLaboratorio({ ...datos, telefono });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '525512345678',
        type: 'document',
        document: {
          id: datos.mediaId,
          filename: datos.nombreArchivo,
          caption: 'Resultados de laboratorio de Firulais. Folio 005.',
        },
      });
      expect(repository.buscarVentanaServicioCliente).toHaveBeenLastCalledWith('525512345678', 9);
      expect(repository.estaVentanaServicioVencida).not.toHaveBeenCalled();
      expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
        expect.objectContaining({
          plantilla: 'documento_resultados_laboratorio',
          exitoso: true,
        }),
      );
    },
  );

  it('sin mensaje entrante reciente conserva la plantilla v2 y es_MX', async () => {
    await enviarResultadoLaboratorio(datos);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('resultados_laboratorio_listos_v2');
    expect(body.template.language.code).toBe('es_MX');
  });

  it.each(['image/jpeg', 'image/png'])(
    'envía %s como imagen, sin campos de documento',
    async (mimetype) => {
      repository.buscarVentanaServicioCliente.mockResolvedValue({ conversacionId: 9 });
      await enviarResultadoLaboratorio({ ...datos, mimetype });
      expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
        messaging_product: 'whatsapp',
        to: '525512345678',
        type: 'image',
        image: { id: 'media-123', caption: 'Resultados de laboratorio de Firulais. Folio 005.' },
      });
      expect(repository.buscarVentanaServicioCliente).toHaveBeenLastCalledWith('525512345678', 9);
      expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
        expect.objectContaining({
          plantilla: 'imagen_resultados_laboratorio',
          exitoso: true,
        }),
      );
    },
  );

  it('no cambia automáticamente de medio tras un fallo de red con resultado incierto', async () => {
    repository.buscarVentanaServicioCliente.mockResolvedValue({ conversacionId: 9 });
    global.fetch.mockRejectedValue(new Error('Timeout'));
    await expect(enviarResultadoLaboratorio(datos)).rejects.toThrow('Timeout');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(intents.size).toBe(1);
    expect(repository.registrarEnvioWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({ exitoso: false }),
    );
  });

  it('si vence mientras se prepara no envía documentos ni cambia a plantilla automáticamente', async () => {
    repository.buscarVentanaServicioCliente
      .mockResolvedValueOnce({ conversacionId: 9 })
      .mockResolvedValueOnce(null);
    await expect(enviarResultadoLaboratorio(datos)).rejects.toMatchObject({
      errorCodigo: 'ventana_servicio_expirada',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(repository.marcarResultadoEnvio).toHaveBeenCalledWith(1, {
      estado: 'ventana_servicio_expirada',
    });
  });

  it('repetir la misma intención no duplica el documento, aunque después venza la ventana', async () => {
    repository.buscarVentanaServicioCliente.mockResolvedValue({ conversacionId: 9 });
    await enviarResultadoLaboratorio(datos);
    repository.buscarVentanaServicioCliente.mockResolvedValue(null);
    await enviarResultadoLaboratorio(datos);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(intents.size).toBe(1);
  });

  it('conserva el código y la referencia de Meta en el rechazo 132001', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 132001,
          fbtrace_id: 'trace-lab',
          message: 'Template name does not exist in the translation',
        },
      }),
    });
    await expect(enviarResultadoLaboratorio(datos)).rejects.toMatchObject({
      errorCodigo: '132001',
      diagnosticoMeta: { codigo: 132001, httpStatus: 400, referenciaMeta: 'trace-lab' },
    });
  });
});
