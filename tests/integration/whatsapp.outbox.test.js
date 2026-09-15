// US WA 015 — outbox_whatsapp: idempotencia real (índice único de wamid) y
// ventana de servicio de 24h contra el reloj real de Postgres. No mockea
// Claude/WhatsApp salvo el `fetch` de envío (necesitamos controlar la
// respuesta de Meta para simular sent/delivered/etc., pero el resto —
// conversaciones_whatsapp.ultima_interaccion_en, el índice único de wamid
// — debe ser Postgres de verdad).
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion-outbox';
const VERIFY_TOKEN = 'verify-token-de-integracion-outbox';

const PHONE_NUMBER_ID = 'phone-integ-outbox-test';
const CLAVE_PREFIX = 'clave-integ-outbox-';

const originalFetch = global.fetch;

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  await db('estados_meta_whatsapp_pendientes')
    .where('wamid', 'like', `wamid.${CLAVE_PREFIX}%`)
    .del();
  await db('outbox_whatsapp').where('clave_idempotencia', 'like', `${CLAVE_PREFIX}%`).del();
  await db('conversaciones_whatsapp').whereIn('id', conversacionIds).del();
  await db.destroy();
});

function firmar(rawBodyString) {
  const hash = crypto.createHmac('sha256', APP_SECRET).update(rawBodyString).digest('hex');
  return `sha256=${hash}`;
}

function payloadEstado(wamid, status) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [{ value: { statuses: [{ id: wamid, status }] }, field: 'messages' }],
      },
    ],
  };
}

async function postEstado(wamid, status) {
  const rawBody = JSON.stringify(payloadEstado(wamid, status));
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

async function crearIntentoDirecto(clave, overrides = {}) {
  const { intent } = await repository.registrarIntentoEnvio({
    claveIdempotencia: clave,
    tipoEnvio: 'laboratorio',
    origenFuncional: 'laboratorio',
    destinatarioTelefono: '525500000000',
    payloadFuncional: { tipo: 'text', destinatarioTelefono: '525500000000', texto: 'hola' },
    usaPlantilla: false,
    ...overrides,
  });
  return intent;
}

describe('outbox_whatsapp — estados de Meta vía webhook (US WA 015 AC3)', () => {
  it.each(['sent', 'delivered', 'read', 'failed'])(
    'un webhook de estado "%s" actualiza el outbox por wamid',
    async (status) => {
      const wamid = `wamid.${CLAVE_PREFIX}${status}`;
      await db('outbox_whatsapp').insert({
        clave_idempotencia: `${CLAVE_PREFIX}${status}`,
        tipo_envio: 'laboratorio',
        origen_funcional: 'laboratorio',
        destinatario_telefono: '525500000000',
        payload_funcional: { tipo: 'text', texto: 'x' },
        estado: 'enviado',
        wamid,
      });

      const res = await postEstado(wamid, status);

      expect(res.status).toBe(200);
      const fila = await db('outbox_whatsapp').where({ wamid }).first();
      expect(fila.estado_meta).toBe(status);
      // AC3: nunca se incorpora como mensaje del tutor ni conversación.
      const mensajes = await db('mensajes_whatsapp').where('whatsapp_message_id', wamid);
      expect(mensajes).toHaveLength(0);
    },
  );

  it('un webhook de estado duplicado no crea una fila extra ni truena (prueba mínima)', async () => {
    const wamid = `wamid.${CLAVE_PREFIX}duplicado`;
    await db('outbox_whatsapp').insert({
      clave_idempotencia: `${CLAVE_PREFIX}duplicado`,
      tipo_envio: 'laboratorio',
      origen_funcional: 'laboratorio',
      destinatario_telefono: '525500000000',
      payload_funcional: { tipo: 'text', texto: 'x' },
      estado: 'enviado',
      wamid,
    });

    const res1 = await postEstado(wamid, 'delivered');
    const res2 = await postEstado(wamid, 'delivered');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const filas = await db('outbox_whatsapp').where({ wamid });
    expect(filas).toHaveLength(1);
    expect(filas[0].estado_meta).toBe('delivered');
  });

  it('conserva y enlaza un estado que llega antes de persistir el wamid', async () => {
    const wamid = `wamid.${CLAVE_PREFIX}estado-temprano`;
    const clave = `${CLAVE_PREFIX}estado-temprano`;

    const res = await postEstado(wamid, 'delivered');

    expect(res.status).toBe(200);
    await expect(
      db('estados_meta_whatsapp_pendientes').where({ wamid }).first(),
    ).resolves.toMatchObject({ estado_meta: 'delivered' });

    const intent = await crearIntentoDirecto(clave);
    await repository.marcarWamid(intent.intent_id, wamid);

    await expect(db('outbox_whatsapp').where({ wamid }).first()).resolves.toMatchObject({
      estado_meta: 'delivered',
    });
    await expect(
      db('estados_meta_whatsapp_pendientes').where({ wamid }).first(),
    ).resolves.toBeUndefined();
  });
});

describe('outbox_whatsapp — ventana de servicio de 24h (US WA 015 AC5)', () => {
  async function crearConversacion(telefono, ultimaInteraccionEn) {
    const [conversacion] = await db('conversaciones_whatsapp')
      .insert({
        phone_number_id: PHONE_NUMBER_ID,
        telefono_normalizado: telefono,
        estado: 'acumulando',
        primer_fragmento_en: ultimaInteraccionEn,
        ultima_interaccion_en: ultimaInteraccionEn,
      })
      .returning('*');
    return conversacion;
  }

  it('envío conversacional DENTRO de la ventana de 24h: se envía', async () => {
    const conversacion = await crearConversacion('525500003001', new Date());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.x1' }] }),
    });
    jest
      .spyOn(whatsappConfig, 'messagesUrl')
      .mockReturnValue('https://graph.facebook.com/fake/messages');
    jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });

    const clave = `${CLAVE_PREFIX}dentro-ventana`;
    await repository.registrarIntentoEnvio({
      claveIdempotencia: clave,
      tipoEnvio: 'conversacional',
      origenFuncional: 'respuesta_automatica',
      conversacionId: conversacion.id,
      destinatarioTelefono: '525500003001',
      payloadFuncional: { tipo: 'text', destinatarioTelefono: '525500003001', texto: 'hola' },
      usaPlantilla: false,
    });

    const resultado = await outbox.ejecutarIntento(clave);

    expect(resultado.enviado).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('envío conversacional FUERA de la ventana de 24h: no envía ni reintenta (AC5)', async () => {
    const hace25Horas = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const conversacion = await crearConversacion('525500003002', hace25Horas);
    global.fetch = jest.fn();

    const clave = `${CLAVE_PREFIX}fuera-ventana`;
    await repository.registrarIntentoEnvio({
      claveIdempotencia: clave,
      tipoEnvio: 'conversacional',
      origenFuncional: 'respuesta_automatica',
      conversacionId: conversacion.id,
      destinatarioTelefono: '525500003002',
      payloadFuncional: { tipo: 'text', destinatarioTelefono: '525500003002', texto: 'hola' },
      usaPlantilla: false,
    });

    const resultado = await outbox.ejecutarIntento(clave);

    expect(resultado).toEqual({ enviado: false, motivo: 'ventana_servicio_expirada' });
    expect(global.fetch).not.toHaveBeenCalled();
    const fila = await db('outbox_whatsapp').where({ clave_idempotencia: clave }).first();
    expect(fila.estado).toBe('ventana_servicio_expirada');
  });
});

describe('outbox_whatsapp — idempotencia de wamid (índice único real)', () => {
  it('dos intentos distintos no pueden compartir el mismo wamid (restricción real de Postgres)', async () => {
    const claveA = `${CLAVE_PREFIX}wamid-a`;
    const claveB = `${CLAVE_PREFIX}wamid-b`;
    const intentA = await crearIntentoDirecto(claveA);
    const intentB = await crearIntentoDirecto(claveB);

    await repository.marcarWamid(intentA.intent_id, 'wamid.compartido');

    // El índice único parcial real de Postgres es lo que impide de verdad
    // que 2 filas terminen con el mismo wamid — no una regla de la app.
    await expect(repository.marcarWamid(intentB.intent_id, 'wamid.compartido')).rejects.toThrow();

    const filas = await db('outbox_whatsapp').where('wamid', 'wamid.compartido');
    expect(filas).toHaveLength(1);
    expect(filas[0].intent_id).toBe(intentA.intent_id);
  });
});

describe('outbox_whatsapp — reclamo concurrente recuperable (US WA 015 AC2)', () => {
  it('dos ejecutores simultáneos producen una sola llamada a Meta', async () => {
    const clave = `${CLAVE_PREFIX}concurrencia`;
    await crearIntentoDirecto(clave);
    let liberarFetch;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          liberarFetch = () =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ messages: [{ id: 'wamid.concurrente' }] }),
            });
        }),
    );
    jest
      .spyOn(whatsappConfig, 'messagesUrl')
      .mockReturnValue('https://graph.facebook.com/fake/messages');
    jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });

    const primero = outbox.ejecutarIntento(clave);
    while (global.fetch.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const segundo = await outbox.ejecutarIntento(clave);
    expect(segundo).toEqual({ enviado: false, motivo: 'envio_en_progreso' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    liberarFetch();
    await expect(primero).resolves.toEqual({ enviado: true, wamid: 'wamid.concurrente' });
  });

  it('un intento cancelado por atención humana nunca llama a Meta', async () => {
    const clave = `${CLAVE_PREFIX}cancelado`;
    const intent = await crearIntentoDirecto(clave);
    await db('outbox_whatsapp')
      .where({ intent_id: intent.intent_id })
      .update({ estado: 'cancelado' });
    global.fetch = jest.fn();

    await expect(outbox.ejecutarIntento(clave)).resolves.toEqual({
      enviado: false,
      motivo: 'cancelado',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('un lease enviando abandonado se recupera después del umbral', async () => {
    const clave = `${CLAVE_PREFIX}lease-abandonado`;
    const intent = await crearIntentoDirecto(clave);
    await db('outbox_whatsapp')
      .where({ intent_id: intent.intent_id })
      .update({
        estado: 'enviando',
        actualizado_en: new Date(Date.now() - 10 * 60 * 1000),
      });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.lease-recuperado' }] }),
    });
    jest
      .spyOn(whatsappConfig, 'messagesUrl')
      .mockReturnValue('https://graph.facebook.com/fake/messages');
    jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });

    await expect(outbox.ejecutarIntento(clave)).resolves.toEqual({
      enviado: true,
      wamid: 'wamid.lease-recuperado',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
