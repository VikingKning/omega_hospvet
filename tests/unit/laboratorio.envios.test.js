// laboratorio.envios.js: envío real de resultados por correo (Nodemailer)
// y WhatsApp (whatsapp.envios.js) — pedido explícito del usuario. Ninguna
// de las 2 funciones debe lanzar NUNCA (un canal fallando no debe tumbar
// laboratorio.service.js#enviarResultados ni al otro canal): siempre
// regresan { ok, error }.
jest.mock('fs/promises');
jest.mock('../../src/config/email');
jest.mock('../../src/modules/whatsapp/whatsapp.envios');
const fs = require('fs/promises');
const email = require('../../src/config/email');
const whatsappEnvios = require('../../src/modules/whatsapp/whatsapp.envios');
const {
  enviarPorCorreo,
  enviarPorWhatsapp,
} = require('../../src/modules/laboratorio/laboratorio.envios');

const ARCHIVO = {
  id: 10,
  nombreOriginal: 'resultados.pdf',
  rutaAbsoluta: '/storage/laboratorio/42/x.pdf',
  mimetype: 'application/pdf',
};

describe('laboratorio.envios.enviarPorCorreo', () => {
  let sendMail;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail = jest.fn().mockResolvedValue({});
    email.getTransporter.mockReturnValue({ sendMail });
  });

  it('manda el correo con el/los archivo(s) como adjuntos y regresa ok:true', async () => {
    const resultado = await enviarPorCorreo({
      destinatario: 'ana@correo.com',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      fechaSolicitud: '2026-08-27',
      folioId: 42,
      archivos: [ARCHIVO],
      calendarioCitas: 'https://calendar.example/agendar',
      googleMapsUrl: 'https://maps.example/ubicacion',
    });

    expect(resultado).toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ana@correo.com',
        subject: expect.stringContaining('Firulais'),
        html: expect.stringContaining('cid:logo-omega'),
        // El logo (Content-ID) siempre va primero, seguido de los archivos
        // reales del registro — ver laboratorio.envios.js#enviarPorCorreo.
        attachments: [
          expect.objectContaining({ cid: 'logo-omega' }),
          { filename: 'Resultado_Omega_01.pdf', path: '/storage/laboratorio/42/x.pdf' },
        ],
      }),
    );
  });

  it('varios archivos distintos se adjuntan todos', async () => {
    const otro = { ...ARCHIVO, id: 11, nombreOriginal: 'otro.jpg', rutaAbsoluta: '/x/otro.jpg' };
    await enviarPorCorreo({
      destinatario: 'ana@correo.com',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      fechaSolicitud: '2026-08-27',
      folioId: 42,
      archivos: [ARCHIVO, otro],
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ cid: 'logo-omega' }),
          { filename: 'Resultado_Omega_01.pdf', path: '/storage/laboratorio/42/x.pdf' },
          { filename: 'Resultado_Omega_02.jpg', path: '/x/otro.jpg' },
        ],
      }),
    );
  });

  it('si Nodemailer truena, regresa ok:false con el mensaje de error — nunca lanza', async () => {
    sendMail.mockRejectedValue(new Error('Conexión SMTP rechazada.'));

    const resultado = await enviarPorCorreo({
      destinatario: 'ana@correo.com',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      fechaSolicitud: '2026-08-27',
      folioId: 42,
      archivos: [ARCHIVO],
    });

    expect(resultado).toEqual({ ok: false, error: 'No se pudo completar el envío por correo.' });
  });

  it('si el correo no está configurado (getTransporter lanza), regresa ok:false — nunca lanza', async () => {
    email.getTransporter.mockImplementation(() => {
      throw new Error('El envío de correo no está configurado (faltan variables de entorno).');
    });

    const resultado = await enviarPorCorreo({
      destinatario: 'ana@correo.com',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      fechaSolicitud: '2026-08-27',
      folioId: 42,
      archivos: [ARCHIVO],
    });

    expect(resultado.ok).toBe(false);
  });
});

describe('laboratorio.envios.enviarPorWhatsapp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.readFile.mockResolvedValue(Buffer.from('contenido'));
    whatsappEnvios.subirMedia.mockResolvedValue('media-id-1');
    whatsappEnvios.enviarResultadoLaboratorio.mockResolvedValue();
  });

  it('sube el archivo y selecciona el envío de resultados, regresa ok:true', async () => {
    const resultado = await enviarPorWhatsapp({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      folioId: 5,
      archivos: [ARCHIVO],
      googleCalendarMeetingUrl: 'https://calendar.example/agendar',
      googleMapsUrl: 'https://maps.example/ubicacion',
    });

    expect(resultado).toEqual({ ok: true });
    expect(whatsappEnvios.subirMedia).toHaveBeenCalledWith(
      Buffer.from('contenido'),
      'application/pdf',
      'Resultado_Omega_01.pdf',
    );
    expect(whatsappEnvios.enviarResultadoLaboratorio).toHaveBeenCalledWith(
      expect.objectContaining({
        telefono: '5512345678',
        nombreTutor: 'Ana Ruiz',
        nombreMascota: 'Firulais',
        folio: '005',
        calendarUrl: 'https://calendar.example/agendar',
        mapsUrl: 'https://maps.example/ubicacion',
        saludo: expect.stringMatching(/^(día|tarde|noche)$/),
        mediaId: 'media-id-1',
        nombreArchivo: 'Resultado_Omega_01.pdf',
      }),
    );
  });

  it('con varios archivos distintos, manda un resultado por cada uno', async () => {
    const otro = { ...ARCHIVO, id: 11, nombreOriginal: 'otro.jpg', rutaAbsoluta: '/x/otro.jpg' };
    await enviarPorWhatsapp({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      archivos: [ARCHIVO, otro],
    });

    expect(whatsappEnvios.subirMedia).toHaveBeenCalledTimes(2);
    expect(whatsappEnvios.enviarResultadoLaboratorio).toHaveBeenCalledTimes(2);
  });

  it('si falla la subida del archivo, regresa ok:false — nunca lanza', async () => {
    whatsappEnvios.subirMedia.mockRejectedValue(new Error('Meta no aceptó el archivo.'));

    const resultado = await enviarPorWhatsapp({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      archivos: [ARCHIVO],
    });

    expect(resultado).toEqual({
      ok: false,
      error: 'No se pudo completar el envío por WhatsApp.',
    });
    expect(whatsappEnvios.enviarResultadoLaboratorio).not.toHaveBeenCalled();
  });

  it('si falla el envío de la plantilla, regresa ok:false — nunca lanza', async () => {
    whatsappEnvios.enviarResultadoLaboratorio.mockRejectedValue(
      new Error('Meta rechazó el envío.'),
    );

    const resultado = await enviarPorWhatsapp({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      archivos: [ARCHIVO],
    });

    expect(resultado).toEqual({
      ok: false,
      error: 'No se pudo completar el envío por WhatsApp.',
    });
  });

  // US WA 007 (ampliación): el bot de WhatsApp reenvía el mismo folio cada
  // vez que el tutor lo consulta — sin un prefijo de clave DISTINTO por
  // cada consulta, el 2° reenvío reusaría la clave del 1° y
  // outbox.ejecutarIntento lo trataría como "ya enviado" sin llamar a Meta.
  it('sin claveIdempotenciaPrefijo, usa el prefijo por defecto "laboratorio:<folioId>" (envío del panel de staff)', async () => {
    await enviarPorWhatsapp({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      folioId: 5,
      archivos: [ARCHIVO],
    });

    expect(whatsappEnvios.enviarResultadoLaboratorio).toHaveBeenCalledWith(
      expect.objectContaining({ claveIdempotencia: 'laboratorio:5:10' }),
    );
  });

  it('con claveIdempotenciaPrefijo explícito, lo usa en vez del default (reenvío desde el bot)', async () => {
    await enviarPorWhatsapp({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      folioId: 5,
      archivos: [ARCHIVO],
      claveIdempotenciaPrefijo: 'mensaje:99:lab:exito',
    });

    expect(whatsappEnvios.enviarResultadoLaboratorio).toHaveBeenCalledWith(
      expect.objectContaining({ claveIdempotencia: 'mensaje:99:lab:exito:10' }),
    );
  });

  it('con 2 archivos, si el segundo falla, no sigue intentando más (corta ahí)', async () => {
    const otro = { ...ARCHIVO, id: 11, nombreOriginal: 'otro.jpg' };
    const tercero = { ...ARCHIVO, id: 12, nombreOriginal: 'tercero.jpg' };
    whatsappEnvios.enviarResultadoLaboratorio
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('Falló en el segundo.'));

    const resultado = await enviarPorWhatsapp({
      telefono: '5512345678',
      nombreTutor: 'Ana Ruiz',
      nombreMascota: 'Firulais',
      archivos: [ARCHIVO, otro, tercero],
    });

    expect(resultado).toEqual({
      ok: false,
      error: 'No se pudo completar el envío por WhatsApp.',
    });
    expect(whatsappEnvios.enviarResultadoLaboratorio).toHaveBeenCalledTimes(2);
  });
});

describe('laboratorio: errores accionables de WhatsApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.readFile.mockResolvedValue(Buffer.from('pdf'));
    whatsappEnvios.subirMedia.mockResolvedValue('media-lab');
  });
  it.each([
    ['132001', /plantilla resultados_laboratorio_listos_v2 en es_MX/],
    ['ventana_servicio_expirada', /ventana de atención.*venció/],
    ['131047', /ventana de atención.*venció/],
  ])('explica %s sin marcar el canal como exitoso', async (errorCodigo, texto) => {
    whatsappEnvios.enviarResultadoLaboratorio.mockRejectedValue(
      Object.assign(new Error('Meta'), { errorCodigo }),
    );
    const resultado = await enviarPorWhatsapp({
      telefono: '5512345678',
      folioId: 5,
      archivos: [ARCHIVO],
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(texto);
    expect(resultado.error).toMatch(/correo/);
  });
});
