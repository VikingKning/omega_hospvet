const crypto = require('crypto');
const env = require('../../src/config/env');
const { verificarFirma, esVerifyTokenValido } = require('../../src/config/whatsapp');

// env.whatsapp.appSecret/webhookVerifyToken vienen vacíos en .env.test (son
// opcionales, ver env.js) — se fuerzan aquí para poder probar los dos
// caminos (configurado/no configurado) sin depender de variables reales.
const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;

afterEach(() => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
});

function firmarComoLoHariaMeta(rawBody, secreto) {
  const hash = crypto.createHmac('sha256', secreto).update(rawBody).digest('hex');
  return `sha256=${hash}`;
}

describe('config/whatsapp.verificarFirma', () => {
  const rawBody = Buffer.from(JSON.stringify({ entry: [] }));

  beforeEach(() => {
    env.whatsapp.appSecret = 'un-app-secret-de-prueba';
  });

  it('acepta una firma calculada correctamente con el App Secret', () => {
    const firma = firmarComoLoHariaMeta(rawBody, 'un-app-secret-de-prueba');
    expect(verificarFirma(rawBody, firma)).toBe(true);
  });

  it('rechaza una firma calculada con un App Secret distinto', () => {
    const firma = firmarComoLoHariaMeta(rawBody, 'otro-secreto');
    expect(verificarFirma(rawBody, firma)).toBe(false);
  });

  it('rechaza una firma calculada sobre un body distinto (payload manipulado)', () => {
    const firma = firmarComoLoHariaMeta(
      Buffer.from('{"entry":["manipulado"]}'),
      'un-app-secret-de-prueba',
    );
    expect(verificarFirma(rawBody, firma)).toBe(false);
  });

  it('rechaza un header sin el prefijo sha256=', () => {
    const hash = crypto
      .createHmac('sha256', 'un-app-secret-de-prueba')
      .update(rawBody)
      .digest('hex');
    expect(verificarFirma(rawBody, hash)).toBe(false);
  });

  it('rechaza si falta el header por completo', () => {
    expect(verificarFirma(rawBody, undefined)).toBe(false);
  });

  it('rechaza siempre si no hay App Secret configurado (WhatsApp no configurado)', () => {
    env.whatsapp.appSecret = undefined;
    const firma = firmarComoLoHariaMeta(rawBody, 'un-app-secret-de-prueba');
    expect(verificarFirma(rawBody, firma)).toBe(false);
  });
});

describe('config/whatsapp.esVerifyTokenValido', () => {
  beforeEach(() => {
    env.whatsapp.webhookVerifyToken = 'el-token-que-elegimos';
  });

  it('acepta el token exacto configurado', () => {
    expect(esVerifyTokenValido('el-token-que-elegimos')).toBe(true);
  });

  it('rechaza un token distinto', () => {
    expect(esVerifyTokenValido('otro-token')).toBe(false);
  });

  it('rechaza siempre si no hay verify token configurado', () => {
    env.whatsapp.webhookVerifyToken = undefined;
    expect(esVerifyTokenValido('el-token-que-elegimos')).toBe(false);
  });
});
