const request = require('supertest');
const app = require('../../src/app');

describe('health check', () => {
  it('GET /health responde 200 con status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('páginas del panel', () => {
  it.each([
    ['/', 'Iniciar sesión'],
    ['/index.html', 'Iniciar sesión'],
    ['/main.html', 'Panel'],
    ['/agenda.html', 'Agenda'],
    ['/grooming.html', 'Grooming'],
    ['/laboratorio.html', 'Laboratorio'],
  ])('GET %s responde 200 y renderiza HTML', async (route, expectedText) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain(expectedText);
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
