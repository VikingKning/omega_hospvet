// US WA 002 — conversaciones_whatsapp: estado y agrupación por número.
// Archivo separado de whatsapp.test.js (mismo criterio que
// whatsapp.envios.test.js siendo un archivo aparte) porque es un concern
// distinto (estado de conversación, no idempotencia del webhook) con
// varios escenarios propios. Necesita Postgres real para el índice único
// parcial (AC2/AC17) — no se puede mockear. Desde US WA 003 el webhook
// solo persiste (nunca clasifica ni envía nada), así que no hace falta
// mockear Claude/WhatsApp aquí.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion-conversaciones';
const VERIFY_TOKEN = 'verify-token-de-integracion-conversaciones';

const WAMID_PREFIX = 'wamid.conv-';
const PHONE_NUMBER_ID = 'phone-integ-conversaciones-test';

const originalFetch = global.fetch;

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

beforeEach(() => {
  // US WA 004: un comando de menú sobre una conversación existente dispara
  // el envío inmediato del menú (fire-and-forget) — se mockea `fetch` para
  // que esas pruebas nunca llamen a Meta de verdad.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages: [{ id: 'wamid.menu-fake' }] }),
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
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
  // US WA 004: outbox_whatsapp.conversacion_id tiene FK hacia
  // conversaciones_whatsapp — hay que borrar primero (mismo orden ya
  // usado en whatsapp.outbox.test.js/whatsapp.agrupacion.test.js).
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('mensajes_whatsapp').where('whatsapp_message_id', 'like', `${WAMID_PREFIX}%`).del();
  await db('conversaciones_whatsapp').where('phone_number_id', PHONE_NUMBER_ID).del();
  await db.destroy();
});

function firmar(rawBodyString) {
  const hash = crypto.createHmac('sha256', APP_SECRET).update(rawBodyString).digest('hex');
  return `sha256=${hash}`;
}

// US WA 003: procesar_despues_de se compara contra el reloj real de
// Postgres (whatsappAgrupacionJob.js) — un timestamp fijo en el pasado
// dejaría la conversación "vencida" para siempre y contaminaría las
// pruebas de agrupación que corren en paralelo contra la misma BD de
// test. El valor exacto nunca importó para lo que este archivo prueba.
function payloadTexto(wamid, from, texto, timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [{ id: wamid, from, timestamp, type: 'text', text: { body: texto } }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

async function postMensaje(wamid, from, texto, timestamp) {
  const rawBody = JSON.stringify(payloadTexto(wamid, from, texto, timestamp));
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

function buscarConversacion(telefonoNormalizado) {
  return db('conversaciones_whatsapp').where({
    phone_number_id: PHONE_NUMBER_ID,
    telefono_normalizado: telefonoNormalizado,
  });
}

describe('POST /webhooks/whatsapp — conversaciones_whatsapp (US WA 002)', () => {
  it('un número sin conversación abierta crea una conversación nueva en acumulando (AC3)', async () => {
    const res = await postMensaje(`${WAMID_PREFIX}nueva`, '5215500001001', 'hola');

    expect(res.status).toBe(200);
    const filas = await buscarConversacion('525500001001');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ estado: 'acumulando' });
    expect(filas[0].procesar_despues_de).not.toBeNull();
  });

  it('calcula la ventana desde la recepción en BD, no desde un timestamp retrasado de Meta', async () => {
    const timestampMetaRetrasado = String(Math.floor(Date.now() / 1000) - 60);
    const antesDeRecibir = Date.now();

    await postMensaje(
      `${WAMID_PREFIX}timestamp-retrasado`,
      '5215500001097',
      'primer fragmento',
      timestampMetaRetrasado,
    );

    const conversacion = await buscarConversacion('525500001097').first();
    expect(new Date(conversacion.procesar_despues_de).getTime()).toBeGreaterThan(
      antesDeRecibir + 9000,
    );
  });

  it('un segundo mensaje del mismo número reutiliza la conversación abierta (AC4)', async () => {
    await postMensaje(`${WAMID_PREFIX}reuso-1`, '5215500001002', 'uno');
    await postMensaje(`${WAMID_PREFIX}reuso-2`, '5215500001002', 'dos');

    const filas = await buscarConversacion('525500001002');
    expect(filas).toHaveLength(1);
  });

  it('varios mensajes del mismo número se asocian a la misma conversacion_id', async () => {
    await postMensaje(`${WAMID_PREFIX}multi-1`, '5215500001003', 'uno');
    await postMensaje(`${WAMID_PREFIX}multi-2`, '5215500001003', 'dos');
    await postMensaje(`${WAMID_PREFIX}multi-3`, '5215500001003', 'tres');

    const conversacion = await buscarConversacion('525500001003').first();
    const mensajes = await db('mensajes_whatsapp')
      .where('whatsapp_message_id', 'like', `${WAMID_PREFIX}multi-%`)
      .andWhere('telefono_origen', '5215500001003');
    expect(mensajes).toHaveLength(3);
    mensajes.forEach((m) => expect(m.conversacion_id).toBe(conversacion.id));
  });

  it('nueva conversación tras un cierre: la anterior queda intacta, cerrada (AC10)', async () => {
    const telefono = '5215500001004';
    await postMensaje(`${WAMID_PREFIX}cierre-1`, telefono, 'hola');
    const [previa] = await buscarConversacion('525500001004');

    await repository.cerrarConversacion(previa.id, new Date());

    await postMensaje(`${WAMID_PREFIX}cierre-2`, telefono, 'de nuevo');

    const filas = await buscarConversacion('525500001004');
    expect(filas).toHaveLength(2);
    const cerrada = filas.find((f) => f.id === previa.id);
    const nueva = filas.find((f) => f.id !== previa.id);
    expect(cerrada.estado).toBe('cerrada');
    expect(nueva.estado).toBe('acumulando');
  });

  it.each(['menu', 'Menú', 'inicio'])(
    'el comando "%s" cambia la conversación a esperando_menu y limpia flujo/paso (AC11)',
    async (comando) => {
      const telefono = `5215500${Math.floor(Math.random() * 900000 + 100000)}`;
      await postMensaje(`${WAMID_PREFIX}menu-1-${comando}`, telefono, 'hola');
      const [conversacion] = await buscarConversacion(telefono.replace(/^521/, '52'));
      await db('conversaciones_whatsapp')
        .where({ id: conversacion.id })
        .update({ flujo_actual: 'laboratorio', paso_actual: 'esperando_folio' });

      await postMensaje(`${WAMID_PREFIX}menu-2-${comando}`, telefono, comando);

      const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
      expect(actualizada.estado).toBe('esperando_menu');
      expect(actualizada.flujo_actual).toBeNull();
      expect(actualizada.paso_actual).toBeNull();
    },
  );

  it('el comando "menu" durante flujo_activo también cambia a esperando_menu', async () => {
    const telefono = '5215500001005';
    await postMensaje(`${WAMID_PREFIX}flujo-1`, telefono, 'hola');
    const [conversacion] = await buscarConversacion('525500001005');
    await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({ estado: 'flujo_activo', flujo_actual: 'laboratorio', paso_actual: 'paso_1' });

    await postMensaje(`${WAMID_PREFIX}flujo-2`, telefono, 'menu');

    const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
    expect(actualizada.estado).toBe('esperando_menu');
  });

  // US WA 017 (AC11/AC12) SUSTITUYE el comportamiento que esta prueba
  // verificaba antes de que esa historia existiera ("conserva el estado" a
  // secas, sin excepción alguna) — ahora "menu" es justo la ÚNICA
  // excepción explícita al silencio de atencion_humana: cierra la
  // conversación vieja (motivo_cierre=solicitud_tutor) y crea una nueva en
  // esperando_menu. El resto de mensajes SÍ siguen sin tocar el estado
  // (cubierto en tests/integration/whatsapp.atencionHumana.test.js).
  it('el comando "menu" durante atencion_humana reactiva el bot (US WA 017 AC11/AC12), no "conserva el estado"', async () => {
    const telefono = '5215500001006';
    await postMensaje(`${WAMID_PREFIX}humana-1`, telefono, 'hola');
    const [conversacion] = await buscarConversacion('525500001006');
    await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({
        estado: 'atencion_humana',
        atencion_humana_hasta: db.raw("now() + interval '5 hours'"),
      });

    await postMensaje(`${WAMID_PREFIX}humana-2`, telefono, 'menu');

    const vieja = await db('conversaciones_whatsapp').where({ id: conversacion.id }).first();
    expect(vieja.estado).toBe('cerrada');
    expect(vieja.motivo_cierre).toBe('solicitud_tutor');

    const [nueva] = await db('conversaciones_whatsapp')
      .where({ phone_number_id: PHONE_NUMBER_ID, telefono_normalizado: '525500001006' })
      .whereNot('estado', 'cerrada');
    expect(nueva.estado).toBe('esperando_menu');
  });

  it('2 inserciones concurrentes para el mismo teléfono solo crean una conversación (AC17)', async () => {
    const telefono = '5215500001007';
    const [res1, res2] = await Promise.all([
      postMensaje(`${WAMID_PREFIX}conc-1`, telefono, 'uno'),
      postMensaje(`${WAMID_PREFIX}conc-2`, telefono, 'dos'),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const filas = await buscarConversacion('525500001007');
    expect(filas).toHaveLength(1);
  });

  it('2 teléfonos procesados simultáneamente generan 2 conversaciones independientes', async () => {
    const [res1, res2] = await Promise.all([
      postMensaje(`${WAMID_PREFIX}tel-a`, '5215500001008', 'hola a'),
      postMensaje(`${WAMID_PREFIX}tel-b`, '5215500001009', 'hola b'),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(await buscarConversacion('525500001008')).toHaveLength(1);
    expect(await buscarConversacion('525500001009')).toHaveLength(1);
  });

  it('una transición inválida (cerrar una conversación ya cerrada) se rechaza sin lanzar (AC18)', async () => {
    await postMensaje(`${WAMID_PREFIX}invalida`, '5215500001010', 'hola');
    const [conversacion] = await buscarConversacion('525500001010');

    const primerCierre = await repository.cerrarConversacion(conversacion.id, new Date());
    const segundoCierre = await repository.cerrarConversacion(conversacion.id, new Date());

    expect(primerCierre).toBe(true);
    expect(segundoCierre).toBe(false);
    const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
    expect(actualizada.estado).toBe('cerrada');
  });
});
