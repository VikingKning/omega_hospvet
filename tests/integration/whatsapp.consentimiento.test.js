// LFPDPPP — gate de consentimiento antes de cualquier procesamiento
// automático de WhatsApp. Mismo patrón de firma/envío que
// whatsapp.agrupacion.test.js. El aviso se sube a Meta como media (igual
// que los resultados de laboratorio, ver whatsapp.envios.js#subirMedia) —
// no depende de ninguna URL pública, así que basta con mockear
// configuracion.service y distinguir la llamada a mediaUrl() de la de
// messagesUrl() en el fetch global.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const configuracionService = require('../../src/modules/configuracion/configuracion.service');
const tutoresRepository = require('../../src/modules/tutores/tutores.repository');
const menu = require('../../src/modules/whatsapp/whatsapp.menu');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion-lfpdppp';
const VERIFY_TOKEN = 'verify-token-de-integracion-lfpdppp';

const WAMID_PREFIX = 'wamid.lfpdppp-';
const PHONE_NUMBER_ID = 'phone-integ-lfpdppp-test';

const AVISO_MOCK = {
  archivo: 'aviso-privacidad-test.pdf',
  version: '2026-09-19',
  nombreArchivo: 'Aviso de Privacidad Omega.pdf',
};

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

let contadorWamidFake = 0;
let contadorMediaFake = 0;
beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (String(url).includes('/fake/media')) {
      contadorMediaFake += 1;
      return { ok: true, json: () => Promise.resolve({ id: `media-fake-${contadorMediaFake}` }) };
    }
    contadorWamidFake += 1;
    return {
      ok: true,
      json: () =>
        Promise.resolve({ messages: [{ id: `wamid.lfpdppp-fake-${contadorWamidFake}` }] }),
    };
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'mediaUrl').mockReturnValue('https://graph.facebook.com/fake/media');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  jest.spyOn(whatsappConfig, 'bearerHeader').mockReturnValue({ Authorization: 'Bearer fake' });
  jest
    .spyOn(claude, 'clasificarMensaje')
    .mockResolvedValue({ etiqueta: null, tokensEntrada: 0, tokensSalida: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  const alertaIds = await db('alertas_atencion_whatsapp')
    .whereIn('conversacion_id', conversacionIds)
    .pluck('id');
  await db('intentos_alerta_whatsapp').whereIn('alerta_id', alertaIds).del();
  await db('destinatarios_alerta_whatsapp').whereIn('alerta_id', alertaIds).del();
  await db('alertas_atencion_whatsapp').whereIn('id', alertaIds).del();
  await db('solicitudes_atencion_humana').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('consentimiento_lfpdppp').where('telefono', 'like', '5255008800%').del();
  await db('mensajes_whatsapp').where('whatsapp_message_id', 'like', `${WAMID_PREFIX}%`).del();
  await db('grupos_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('conversaciones_whatsapp').where('phone_number_id', PHONE_NUMBER_ID).del();
  await db.destroy();
});

function firmar(rawBodyString) {
  const hash = crypto.createHmac('sha256', APP_SECRET).update(rawBodyString).digest('hex');
  return `sha256=${hash}`;
}

function ahoraEpoch(offsetSegundos = 0) {
  return String(Math.floor(Date.now() / 1000) + offsetSegundos);
}

function payloadBase(wamid, from, timestamp, mensajeExtra) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [{ id: wamid, from, timestamp, ...mensajeExtra }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

async function postTexto(wamid, from, texto, timestamp = ahoraEpoch()) {
  const rawBody = payloadBase(wamid, from, timestamp, { type: 'text', text: { body: texto } });
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

async function postBoton(wamid, from, botonId, tituloBoton, timestamp = ahoraEpoch()) {
  const rawBody = payloadBase(wamid, from, timestamp, {
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: botonId, title: tituloBoton } },
  });
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

async function postListReply(wamid, from, listId, tituloOpcion, timestamp = ahoraEpoch()) {
  const rawBody = payloadBase(wamid, from, timestamp, {
    type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: listId, title: tituloOpcion } },
  });
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

function buscarConversacion(telefonoNormalizado) {
  return db('conversaciones_whatsapp')
    .where({ phone_number_id: PHONE_NUMBER_ID, telefono_normalizado: telefonoNormalizado })
    .orderBy('id', 'desc');
}

function ultimoMensaje(whatsappMessageId) {
  return db('mensajes_whatsapp').where({ whatsapp_message_id: whatsappMessageId }).first();
}

function ultimoRegistroConsentimiento(telefono) {
  return db('consentimiento_lfpdppp').where({ telefono }).orderBy('creado_en', 'desc').first();
}

// El envío del menú tras el comando "menu" es fire-and-forget en el
// controller (nunca se espera antes de responder 200) — sin esta pausa, su
// llamada a fetch puede colarse en el conteo de la siguiente prueba.
function esperarFireAndForget() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('LFPDPPP — gate de consentimiento (feature apagada)', () => {
  it('sin aviso configurado, un mensaje nuevo se agrupa y clasifica normalmente (sin cambios de comportamiento)', async () => {
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue(null);
    const telefono = '5215500880001';

    const res = await postTexto(`${WAMID_PREFIX}apagada-1`, telefono, 'hola, tengo una duda');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}apagada-1`);
    expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/);
    const registro = await ultimoRegistroConsentimiento('525500880001');
    expect(registro).toBeUndefined();
  });
});

describe('LFPDPPP — gate de consentimiento (feature activa)', () => {
  // insertarPendiente guarda version_aviso, y desde la migración 20260919000007
  // esa columna tiene FK contra aviso_privacidad_versiones.version — aunque
  // el servicio esté mockeado, la fila real debe existir para poder insertar.
  beforeAll(async () => {
    await db('aviso_privacidad_versiones').insert({
      version: AVISO_MOCK.version,
      nombre_archivo: AVISO_MOCK.archivo,
      nombre_original: AVISO_MOCK.nombreArchivo,
    });
  });

  afterAll(async () => {
    await db('consentimiento_lfpdppp').where('version_aviso', AVISO_MOCK.version).del();
    await db('aviso_privacidad_versiones').where({ nombre_archivo: AVISO_MOCK.archivo }).del();
  });

  beforeEach(() => {
    jest
      .spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio')
      .mockResolvedValue(AVISO_MOCK);
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  });

  it('primer mensaje de un teléfono nuevo: sube el PDF a Meta, manda el aviso, inserta fila pendiente y no forma grupo', async () => {
    const telefono = '5215500880010';

    const res = await postTexto(`${WAMID_PREFIX}nuevo-1`, telefono, 'necesito ayuda con mi perro');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}nuevo-1`);
    expect(mensaje.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');
    expect(mensaje.group_id).toBeNull();

    const registro = await ultimoRegistroConsentimiento('525500880010');
    expect(registro).toMatchObject({
      acepto: null,
      canal: 'whatsapp',
      version_aviso: AVISO_MOCK.version,
    });
    expect(registro.aviso_enviado_en).not.toBeNull();

    // 1 llamada para subir el PDF a Meta (Media API) + 1 para mandar el mensaje.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [urlMedia] = global.fetch.mock.calls[0];
    expect(urlMedia).toContain('/fake/media');
    const [, opcionesMensaje] = global.fetch.mock.calls[1];
    const cuerpoEnviado = JSON.parse(opcionesMensaje.body);
    expect(cuerpoEnviado.interactive.type).toBe('button');
    expect(cuerpoEnviado.interactive.header).toMatchObject({
      type: 'document',
      document: { id: 'media-fake-1', filename: AVISO_MOCK.nombreArchivo },
    });
  });

  it('un segundo mensaje mientras está pendiente se ignora y NO reenvía el aviso (ni sube el PDF de nuevo)', async () => {
    const telefono = '5215500880011';
    await postTexto(`${WAMID_PREFIX}pendiente-1`, telefono, 'hola');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const res = await postTexto(`${WAMID_PREFIX}pendiente-2`, telefono, 'sigo esperando');

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2); // no se volvió a mandar ni a subir
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}pendiente-2`);
    expect(mensaje.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');
  });

  it('al aceptar el aviso, se resuelve la fila y los mensajes posteriores fluyen normal', async () => {
    const telefono = '5215500880012';
    await postTexto(`${WAMID_PREFIX}acepta-0`, telefono, 'hola');

    const resBoton = await postBoton(
      `${WAMID_PREFIX}acepta-boton`,
      telefono,
      'lfpdppp_acepto',
      'Estoy de acuerdo',
    );
    expect(resBoton.status).toBe(200);

    const registro = await ultimoRegistroConsentimiento('525500880012');
    expect(registro).toMatchObject({ acepto: true, wamid: `${WAMID_PREFIX}acepta-boton` });
    const mensajeBoton = await ultimoMensaje(`${WAMID_PREFIX}acepta-boton`);
    expect(mensajeBoton.estado_procesamiento).toBe('resuelto_lfpdppp');

    const resTexto = await postTexto(`${WAMID_PREFIX}acepta-real`, telefono, 'mi perro tose mucho');
    expect(resTexto.status).toBe(200);
    const mensajeReal = await ultimoMensaje(`${WAMID_PREFIX}acepta-real`);
    expect(mensajeReal.estado_procesamiento).not.toMatch(/lfpdppp/);
  });

  it('al rechazar el aviso, se resuelve la fila y se solicita atención humana', async () => {
    const telefono = '5215500880013';
    await postTexto(`${WAMID_PREFIX}rechaza-0`, telefono, 'hola');

    const resBoton = await postBoton(
      `${WAMID_PREFIX}rechaza-boton`,
      telefono,
      'lfpdppp_rechazo',
      'No estoy de acuerdo',
    );
    expect(resBoton.status).toBe(200);

    const registro = await ultimoRegistroConsentimiento('525500880013');
    expect(registro).toMatchObject({ acepto: false });

    const [conversacion] = await buscarConversacion('525500880013');
    const solicitud = await db('solicitudes_atencion_humana')
      .where({ conversacion_id: conversacion.id, origen: 'consentimiento' })
      .first();
    expect(solicitud).toBeDefined();
    const alerta = await db('alertas_atencion_whatsapp')
      .where({ conversacion_id: conversacion.id, tipo_alerta: 'consentimiento' })
      .first();
    expect(alerta).toBeDefined();
  });

  it('un tutor dado de alta en el panel ya tiene consentimiento aceptado (canal panel) y su primer WhatsApp fluye normal', async () => {
    const telefonoDigitos = '5500880014';
    const propietarioId = await tutoresRepository.crear({
      nombre: 'Test',
      apellidos: 'LFPDPPP',
      telefono: telefonoDigitos,
      correo: 'test.lfpdppp@omegavet.test',
      pacientes: [],
      usuarioId: null,
    });

    const registro = await ultimoRegistroConsentimiento(`52${telefonoDigitos}`);
    expect(registro).toMatchObject({ acepto: true, canal: 'panel', propietario_id: propietarioId });

    const res = await postTexto(`${WAMID_PREFIX}panel-1`, `521${telefonoDigitos}`, 'hola');
    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}panel-1`);
    expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/);

    await db('mascotas').where({ propietario_id: propietarioId }).del();
    await db('propietarios').where({ id: propietarioId }).del();
  });
});

describe('LFPDPPP — el media_id se cachea y no se resube en cada solicitud', () => {
  const NOMBRE_ARCHIVO = 'aviso-privacidad-cache-test.pdf';

  beforeEach(async () => {
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    await db('configuracion_sistema')
      .insert([
        { clave: 'aviso_privacidad_archivo', valor: NOMBRE_ARCHIVO },
        { clave: 'aviso_privacidad_version', valor: 'v-cache-test' },
        { clave: 'aviso_privacidad_nombre', valor: 'Aviso Cache Test.pdf' },
      ])
      .onConflict('clave')
      .merge(['valor']);
    await db('aviso_privacidad_versiones').insert({
      version: 'v-cache-test',
      nombre_archivo: NOMBRE_ARCHIVO,
      nombre_original: 'Aviso Cache Test.pdf',
    });
  });

  afterEach(async () => {
    // Los consentimientos creados por este test referencian esta versión
    // (FK con ON DELETE RESTRICT, ver migración 20260919000007) — deben
    // borrarse primero o el delete de aviso_privacidad_versiones falla.
    await db('consentimiento_lfpdppp').where('telefono', 'like', '52550088003%').del();
    await db('configuracion_sistema').where('clave', 'like', 'aviso_privacidad_%').del();
    await db('aviso_privacidad_versiones').where({ nombre_archivo: NOMBRE_ARCHIVO }).del();
  });

  it('dos teléfonos nuevos distintos disparan una sola subida a Meta, no dos', async () => {
    await postTexto(`${WAMID_PREFIX}cache-tel1`, '5215500880030', 'hola');
    await postTexto(`${WAMID_PREFIX}cache-tel2`, '5215500880031', 'hola');

    const llamadasAMedia = global.fetch.mock.calls.filter(([url]) =>
      String(url).includes('/fake/media'),
    );
    expect(llamadasAMedia).toHaveLength(1);

    const fila = await db('aviso_privacidad_versiones')
      .where({ nombre_archivo: NOMBRE_ARCHIVO })
      .first();
    expect(fila.media_id).toMatch(/^media-fake-\d+$/);
  });
});

describe('LFPDPPP — integridad referencial version_aviso -> aviso_privacidad_versiones', () => {
  const TELEFONO = '5215500990099';
  let versionId;

  afterEach(async () => {
    await db('consentimiento_lfpdppp').where({ telefono: TELEFONO }).del();
    if (versionId) {
      await db('aviso_privacidad_versiones')
        .where({ id: versionId })
        .del()
        .catch(() => {});
      versionId = null;
    }
  });

  it('la base de datos rechaza borrar una versión mientras un consentimiento la referencie', async () => {
    const [fila] = await db('aviso_privacidad_versiones')
      .insert({
        version: `v-integridad-${Date.now()}`,
        nombre_archivo: `aviso-integridad-${crypto.randomUUID()}.pdf`,
        nombre_original: 'aviso.pdf',
      })
      .returning('*');
    versionId = fila.id;

    await db('consentimiento_lfpdppp').insert({
      telefono: TELEFONO,
      acepto: true,
      canal: 'whatsapp',
      version_aviso: fila.version,
    });

    await expect(db('aviso_privacidad_versiones').where({ id: versionId }).del()).rejects.toThrow();
  });
});

describe('LFPDPPP — "Ver aviso de privacidad" en el menú principal', () => {
  it('con aviso configurado, envía el PDF como documento informativo (sin botones de aceptar/rechazar)', async () => {
    const AVISO = {
      archivo: 'aviso-privacidad-test.pdf',
      version: '2026-09-19',
      nombreArchivo: 'Aviso de Privacidad Omega.pdf',
    };
    // Aceptar el aviso inserta version_aviso en consentimiento_lfpdppp, y
    // esa columna tiene FK contra aviso_privacidad_versiones.version desde
    // la migración 20260919000007 — hace falta la fila real aunque el
    // servicio esté mockeado.
    await db('aviso_privacidad_versiones').insert({
      version: AVISO.version,
      nombre_archivo: AVISO.archivo,
      nombre_original: AVISO.nombreArchivo,
    });
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue(AVISO);
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    const telefono = '5215500880020';

    try {
      // Primero hay que aceptar el aviso para poder llegar al menú (si no,
      // el gate se come hasta el comando "menu").
      await postTexto(`${WAMID_PREFIX}menuaviso-0`, telefono, 'hola');
      await postBoton(
        `${WAMID_PREFIX}menuaviso-acepto`,
        telefono,
        'lfpdppp_acepto',
        'Estoy de acuerdo',
      );
      await postTexto(`${WAMID_PREFIX}menuaviso-menu`, telefono, 'menu');
      await esperarFireAndForget();

      global.fetch.mockClear();
      const res = await postListReply(
        `${WAMID_PREFIX}menuaviso-seleccion`,
        telefono,
        menu.MENU_AVISO_PRIVACIDAD,
        'Aviso de privacidad',
      );

      expect(res.status).toBe(200);
      // 1 llamada para subir el PDF a Meta + 1 para mandar el documento.
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [urlMedia] = global.fetch.mock.calls[0];
      expect(urlMedia).toContain('/fake/media');
      const [, opcionesDocumento] = global.fetch.mock.calls[1];
      const cuerpoEnviado = JSON.parse(opcionesDocumento.body);
      expect(cuerpoEnviado.type).toBe('document');
      expect(cuerpoEnviado.document).toMatchObject({
        id: expect.stringContaining('media-fake-'),
        filename: 'Aviso de Privacidad Omega.pdf',
      });
      expect(cuerpoEnviado.interactive).toBeUndefined();
    } finally {
      await db('consentimiento_lfpdppp').where('version_aviso', AVISO.version).del();
      await db('aviso_privacidad_versiones').where({ nombre_archivo: AVISO.archivo }).del();
    }
  });

  it('sin aviso configurado, manda un texto de respaldo en vez de fallar en silencio', async () => {
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue(null);
    const telefono = '5215500880021';

    // Este teléfono nunca ve el gate LFPDPPP porque la funcionalidad está
    // apagada (sin aviso configurado) — llega al menú directo.
    await postTexto(`${WAMID_PREFIX}menuaviso2-menu`, telefono, 'menu');
    await esperarFireAndForget();

    global.fetch.mockClear();
    const res = await postListReply(
      `${WAMID_PREFIX}menuaviso2-seleccion`,
      telefono,
      menu.MENU_AVISO_PRIVACIDAD,
      'Aviso de privacidad',
    );

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1); // solo el texto de respaldo
    const [, opciones] = global.fetch.mock.calls[0];
    const cuerpoEnviado = JSON.parse(opciones.body);
    expect(cuerpoEnviado.type).toBe('text');
    expect(cuerpoEnviado.text.body).toContain('no tenemos un aviso de privacidad disponible');
  });
});
