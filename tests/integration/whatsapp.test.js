// Webhook de WhatsApp (callback externo de Meta) — a diferencia del resto
// de los módulos, sin requireAuth/CSRF (ver comentario en app.js). Cubre
// solo forma/permisos: handshake del GET, y que el POST exija una firma
// HMAC válida antes de aceptar nada. El flujo completo (clasificación con
// Claude + envío de respuesta) ya está cubierto, mockeado, en
// tests/unit/whatsapp.service.test.js — aquí nunca se manda un mensaje real
// para no depender de Claude/WhatsApp en integración.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion';
const VERIFY_TOKEN = 'verify-token-de-integracion';

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

afterAll(async () => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
  await db.destroy();
});

function firmar(rawBodyString) {
  const hash = crypto.createHmac('sha256', APP_SECRET).update(rawBodyString).digest('hex');
  return `sha256=${hash}`;
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
});
