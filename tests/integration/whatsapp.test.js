// Webhook de WhatsApp (callback externo de Meta) — a diferencia del resto
// de los módulos, sin requireAuth/CSRF (ver comentario en app.js). Cubre
// forma/permisos (handshake del GET, firma HMAC en el POST) Y, desde US WA
// 001, la idempotencia REAL de la persistencia (restricción UNIQUE de
// whatsapp_message_id) — esto necesita Postgres de verdad, no se puede
// mockear, por eso vive aquí y no en whatsapp.controller.test.js. Desde
// US WA 003 el webhook solo persiste (nunca clasifica ni envía nada), así
// que no hace falta mockear Claude/WhatsApp aquí.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion';
const VERIFY_TOKEN = 'verify-token-de-integracion';

// Prefijo de los wamid que crean estos tests — permite limpiarlos todos al
// final con un solo DELETE, mismo criterio que
// tests/integration/plantillas_whatsapp.test.js con su SUFFIX.
const WAMID_PREFIX = 'wamid.integ-';
const PHONE_NUMBER_ID = 'phone-integ-whatsapp-test';

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

afterAll(async () => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
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

describe('GET /webhooks/whatsapp (handshake)', () => {
  it('con el verify_token correcto, responde 200 y repite hub.challenge tal cual', async () => {
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'reto-123',
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe('reto-123');
  });

  it('con un verify_token incorrecto, responde 403', async () => {
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'no-es-el-token-correcto',
      'hub.challenge': 'reto-123',
    });

    expect(res.status).toBe(403);
  });

  it('sin hub.mode=subscribe, responde 403 aunque el token sea correcto', async () => {
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'reto-123',
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/whatsapp (recepción de mensajes)', () => {
  afterEach(async () => {
    await db('configuracion_funciones')
      .where({ clave: 'whatsapp_respuestas_automaticas' })
      .update({ habilitado: true });
  });

  it('sin firma, responde 401', async () => {
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .send(JSON.stringify({ entry: [] }));

    expect(res.status).toBe(401);
  });

  it('con una firma que no coincide con el body, responde 401', async () => {
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', 'sha256=firma-inventada')
      .send(JSON.stringify({ entry: [] }));

    expect(res.status).toBe(401);
  });

  it('con firma válida pero un payload sin messages (ej. recibo de entrega), responde 200', async () => {
    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              value: { statuses: [{ id: 'wamid.fake', status: 'delivered' }] },
              field: 'messages',
            },
          ],
        },
      ],
    });

    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBody))
      .send(rawBody);

    expect(res.status).toBe(200);
  });

  it('con firma inválida y un mensaje real, no persiste nada', async () => {
    const wamid = `${WAMID_PREFIX}firma-invalida`;
    const rawBody = JSON.stringify(payloadTexto(wamid, '5215500000000', 'no debería guardarse'));

    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', 'sha256=firma-inventada')
      .send(rawBody);

    expect(res.status).toBe(401);
    const filas = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid });
    expect(filas).toHaveLength(0);
  });

  it('con respuestas automáticas deshabilitadas confirma el webhook sin registrar el mensaje', async () => {
    await db('configuracion_funciones')
      .where({ clave: 'whatsapp_respuestas_automaticas' })
      .update({ habilitado: false });
    const wamid = `${WAMID_PREFIX}bot-deshabilitado`;
    const rawBody = JSON.stringify(
      payloadTexto(wamid, '5215500000099', 'este mensaje debe ignorarse'),
    );

    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBody))
      .send(rawBody);

    expect(res.status).toBe(200);
    const mensajes = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid });
    const conversaciones = await db('conversaciones_whatsapp').where({
      phone_number_id: PHONE_NUMBER_ID,
      telefono_normalizado: '525500000099',
    });
    expect(mensajes).toHaveLength(0);
    expect(conversaciones).toHaveLength(0);
  });

  it('un mensaje nuevo con wamid válido crea una fila en mensajes_whatsapp', async () => {
    const wamid = `${WAMID_PREFIX}nuevo`;
    const rawBody = JSON.stringify(payloadTexto(wamid, '5215500000001', 'hola'));

    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBody))
      .send(rawBody);

    expect(res.status).toBe(200);
    const filas = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      telefono_origen: '5215500000001',
      mensaje_recibido: 'hola',
      tipo_mensaje: 'text',
      direccion: 'entrante',
    });
  });

  it('una reentrega del mismo wamid no crea una segunda fila (AC4)', async () => {
    const wamid = `${WAMID_PREFIX}reentrega`;
    const rawBody = JSON.stringify(payloadTexto(wamid, '5215500000002', 'hola de nuevo'));

    const res1 = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBody))
      .send(rawBody);
    const res2 = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBody))
      .send(rawBody);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const filas = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid });
    expect(filas).toHaveLength(1);
  });

  it('2 solicitudes concurrentes con el mismo wamid solo crean una fila (AC5)', async () => {
    const wamid = `${WAMID_PREFIX}concurrente`;
    const rawBody = JSON.stringify(payloadTexto(wamid, '5215500000003', 'concurrencia'));
    const firma = firmar(rawBody);

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/webhooks/whatsapp')
        .type('json')
        .set('X-Hub-Signature-256', firma)
        .send(rawBody),
      request(app)
        .post('/webhooks/whatsapp')
        .type('json')
        .set('X-Hub-Signature-256', firma)
        .send(rawBody),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const filas = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid });
    expect(filas).toHaveLength(1);
  });

  it('un payload con varios mensajes distintos crea una fila por cada wamid (AC3)', async () => {
    const wamidA = `${WAMID_PREFIX}multi-a`;
    const wamidB = `${WAMID_PREFIX}multi-b`;
    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    id: wamidA,
                    from: '5215500000004',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'uno' },
                  },
                  {
                    id: wamidB,
                    from: '5215500000005',
                    timestamp: String(Math.floor(Date.now() / 1000) + 1),
                    type: 'text',
                    text: { body: 'dos' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    });

    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBody))
      .send(rawBody);

    expect(res.status).toBe(200);
    const filas = await db('mensajes_whatsapp').whereIn('whatsapp_message_id', [wamidA, wamidB]);
    expect(filas).toHaveLength(2);
  });

  it('un payload con un mensaje nuevo y otro duplicado solo agrega el nuevo', async () => {
    const wamidExistente = `${WAMID_PREFIX}mix-existente`;
    const wamidNuevo = `${WAMID_PREFIX}mix-nuevo`;
    const rawBodyPrimero = JSON.stringify(payloadTexto(wamidExistente, '5215500000006', 'primero'));
    await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBodyPrimero))
      .send(rawBodyPrimero);

    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    id: wamidExistente,
                    from: '5215500000006',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'primero' },
                  },
                  {
                    id: wamidNuevo,
                    from: '5215500000007',
                    timestamp: String(Math.floor(Date.now() / 1000) + 2),
                    type: 'text',
                    text: { body: 'nuevo' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    });

    const res = await request(app)
      .post('/webhooks/whatsapp')
      .type('json')
      .set('X-Hub-Signature-256', firmar(rawBody))
      .send(rawBody);

    expect(res.status).toBe(200);
    const filasExistente = await db('mensajes_whatsapp').where({
      whatsapp_message_id: wamidExistente,
    });
    expect(filasExistente).toHaveLength(1);
    const filasNuevo = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamidNuevo });
    expect(filasNuevo).toHaveLength(1);
  });
});
