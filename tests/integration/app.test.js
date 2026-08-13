const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

afterAll(async () => {
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('health check', () => {
  it('GET /health responde 200 con status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('página de login (pública)', () => {
  it.each([
    ['/', 'Iniciar sesión'],
    ['/index.html', 'Iniciar sesión'],
  ])('GET %s responde 200 y renderiza HTML con token CSRF', async (route) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Iniciar sesión');
    expect(res.text).toMatch(/id="csrfToken" value="[^"]+"/);
  });
});

describe('páginas del panel sin sesión (AC de US-101: nunca públicas)', () => {
  it.each([['/main.html'], ['/agenda.html'], ['/grooming.html'], ['/laboratorio.html']])(
    'GET %s sin sesión redirige a /',
    async (route) => {
      const res = await request(app).get(route);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    },
  );
});

describe('POST /login sin token CSRF', () => {
  // Este caso no toca la base de datos: el CSRF se valida antes que
  // cualquier otra cosa, incluyendo Joi. El resto del flujo de login
  // (AC1-AC5 de US-101, que sí requieren un token CSRF válido y por lo
  // tanto sesión persistida) vive en tests/integration/auth.test.js contra
  // una base de datos de pruebas real.
  it('responde 403', async () => {
    const res = await request(app).post('/login').send({ username: 'admin', password: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('rutas inexistentes', () => {
  it('GET /no-existe responde 404 con JSON de error', async () => {
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No encontrado' });
  });
});

describe('assets sensibles', () => {
  it('el esquema de base de datos (assets/sql) nunca se expone', async () => {
    const res = await request(app).get('/assets/sql/Omega-Database.sql');
    expect(res.status).toBe(404);
  });
});
