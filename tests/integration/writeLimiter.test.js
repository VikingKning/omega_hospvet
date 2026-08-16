// SEC-003 (reporte de seguridad): las rutas de escritura de áreas/doctores/
// plantillas/usuarios no tenían límite de velocidad. Este archivo prueba el
// middleware compartido (writeLimiter.js) contra una sola ruta real
// (POST /areas.html, el filtro) en vez de duplicar la prueba en los 4
// módulos — el middleware es el mismo objeto en los 16 puntos donde se
// insertó, así que probarlo una vez alcanza. Se usa /areas.html porque es de
// solo lectura (filtro): dispararlo decenas de veces seguidas no deja
// basura que limpiar, a diferencia de martillar POST /areas (crearía
// decenas de filas).
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');
const { MAX_REQUESTS } = require('../../src/middlewares/writeLimiter');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function getCsrfToken(agent) {
  const res = await agent.get('/');
  const match = res.text.match(/id="csrfToken" value="([^"]+)"/);
  return match[1];
}

async function loginAsAdmin() {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent
    .post('/login')
    .set('x-csrf-token', csrfToken)
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  return agent;
}

async function getAreasCsrfToken(agent) {
  const res = await agent.get('/areas.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

afterAll(async () => {
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('writeLimiter (SEC-003)', () => {
  it('bloquea con 429 tras exceder el límite en una ruta de escritura', async () => {
    const agent = await loginAsAdmin();
    const csrfToken = await getAreasCsrfToken(agent);

    // Secuencial, no Promise.all: disparar MAX_REQUESTS peticiones a la vez
    // (todas contra el mismo pool de conexiones de Knex, max:10) agota el
    // pool y produce ECONNRESET antes de siquiera llegar al límite del
    // rate limiter — el conteo del límite no depende de la concurrencia,
    // así que ir una por una prueba lo mismo sin ese ruido.
    for (let i = 0; i < MAX_REQUESTS; i += 1) {
      const res = await agent
        .post('/areas.html')
        .type('form')
        .set('x-csrf-token', csrfToken)
        .send({});
      expect(res.status).not.toBe(429);
    }

    const oneMore = await agent
      .post('/areas.html')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(oneMore.status).toBe(429);
    expect(oneMore.body).toEqual({ error: expect.any(String) });
  }, 30000);

  it('no afecta rutas fuera de su alcance (login, health) aunque el límite ya se haya disparado', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);

    const loginAgent = request.agent(app);
    const csrfToken = await getCsrfToken(loginAgent);
    const login = await loginAgent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: 'usuario_inexistente_writeLimiter', password: 'ClaveIncorrecta123!' });
    expect(login.status).not.toBe(429);
  });
});
