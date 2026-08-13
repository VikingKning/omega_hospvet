// Pruebas de integración del flujo de login (US-101) contra una base de
// datos real (misma estructura que producción, ver .env.test). Requieren
// `pnpm run migrate` + `pnpm run seed` corridos antes (así se levanta en CI:
// ver .github/workflows/ci.yml).
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const INACTIVE_USER = {
  username: 'inactivo.test',
  password: 'InactivoTest123!',
};

async function getCsrfToken(agent) {
  const res = await agent.get('/');
  const match = res.text.match(/id="csrfToken" value="([^"]+)"/);
  return match[1];
}

// A nivel de archivo (no dentro de un describe): estos hooks deben correr
// una sola vez, antes/después de TODOS los describe de este archivo. Si
// vivieran dentro del primer describe, su afterAll cerraría la conexión a
// la base de datos antes de que corrieran los describe siguientes.
beforeAll(async () => {
  await db('usuarios')
    .insert({
      nombre: 'Inactivo',
      apellidos: 'Test',
      correo: 'inactivo.test@omegavet.test',
      username: INACTIVE_USER.username,
      password_hash: await bcrypt.hash(INACTIVE_USER.password, 4),
      activo: false,
      creado_en: db.fn.now(),
    })
    .onConflict('username')
    .merge();
});

afterAll(async () => {
  await db('usuarios').where({ username: INACTIVE_USER.username }).del();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('flujo de login (US-101)', () => {
  it('AC1: usuario o contraseña vacíos responde 400', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: '', password: '' });

    expect(res.status).toBe(400);
  });

  it('AC3: credenciales correctas + cuenta activa -> crea sesión y permite acceder al panel', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const loginRes = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toEqual({ redirectTo: '/main.html' });

    // La misma sesión ya autenticada puede entrar al panel.
    const mainRes = await agent.get('/main.html');
    expect(mainRes.status).toBe(200);
    expect(mainRes.text).toContain('Bienvenido');
  });

  it('AC6: el sidebar solo muestra módulos con permiso otorgado (admin sembrado tiene todos)', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const mainRes = await agent.get('/main.html');
    expect(mainRes.text).toContain('Laboratorio');
    expect(mainRes.text).toContain('Consultas y cirugías');
  });

  it('AC4: contraseña incorrecta responde 401 con mensaje genérico', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: ADMIN_USERNAME, password: 'contraseña-incorrecta' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Usuario o contraseña incorrectos.');
  });

  it('AC4: usuario inexistente responde 401 con el mismo mensaje genérico', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: 'no-existe-este-usuario', password: 'lo-que-sea' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Usuario o contraseña incorrectos.');
  });

  it('AC5: cuenta desactivada + credenciales correctas responde 403 (cuenta inactiva)', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: INACTIVE_USER.username, password: INACTIVE_USER.password });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/desactivada/);
  });
});

describe('cerrar sesión (US-107)', () => {
  async function loginAgent() {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    return agent;
  }

  it('AC1: invalida la sesión en el servidor (borra la fila en session) y redirige al login', async () => {
    const agent = await loginAgent();
    const before = await db('session').count('* as count').first();

    const res = await agent.get('/logout');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const after = await db('session').count('* as count').first();
    expect(Number(after.count)).toBe(Number(before.count) - 1);
  });

  it('AC2: tras cerrar sesión, la pantalla protegida ya no es accesible con la misma cookie (simula "Atrás")', async () => {
    const agent = await loginAgent();

    const beforeLogout = await agent.get('/main.html');
    expect(beforeLogout.status).toBe(200);
    // Sin esto, el navegador podría servir esta misma respuesta desde
    // bfcache al presionar "Atrás", sin volver a preguntarle al servidor.
    expect(beforeLogout.headers['cache-control']).toBe('no-store');

    await agent.get('/logout');

    const afterLogout = await agent.get('/main.html');
    expect(afterLogout.status).toBe(302);
    expect(afterLogout.headers.location).toBe('/');
  });

  it('AC3: cerrar sesión no modifica datos del usuario', async () => {
    const agent = await loginAgent();
    const before = await db('usuarios').where({ username: ADMIN_USERNAME }).first();

    await agent.get('/logout');

    const after = await db('usuarios').where({ username: ADMIN_USERNAME }).first();
    expect(after).toEqual(before);
  });
});
