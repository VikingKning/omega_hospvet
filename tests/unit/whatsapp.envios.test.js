// whatsapp.envios.js: envío PROACTIVO de WhatsApp (resultados de
// laboratorio) — subir el archivo real (subirMedia) y mandar la plantilla
// 'resultados_laboratorio_listos' referenciándolo (enviarPlantillaResultados).
// A diferencia de whatsapp.service.js (mensajes ENTRANTES), acá SÍ debe
// lanzar cuando Meta responde con un error — laboratorio.envios.js es
// quien decide "nunca lanzar hacia arriba" (ver ese test file).
const whatsappConfig = require('../../src/config/whatsapp');
jest.mock('../../src/modules/whatsapp/whatsapp.repository');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const {
  subirMedia,
  enviarPlantillaResultados,
} = require('../../src/modules/whatsapp/whatsapp.envios');

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  jest.spyOn(whatsappConfig, 'mediaUrl').mockReturnValue('https://graph.facebook.com/fake/media');
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'bearerHeader').mockReturnValue({ Authorization: 'Bearer fake' });
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
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
