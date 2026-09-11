const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function getCsrfToken(agent) {
  const res = await agent.get('/');
  const match = res.text.match(/id="csrfToken" value="([^"]+)"/);
  return match[1];
}

// Cualquier usuario logueado sirve — la página 404 solo exige sesión activa
// (requireAuth no aplica aquí, ver notFound en errorHandler.js), sin ningún
// permiso puntual, así que no hace falta un usuario de prueba desechable.
async function loginAsAdmin() {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent
    .post('/login')
    .set('x-csrf-token', csrfToken)
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  return agent;
}

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
  it.each([
    ['/main.html'],
    ['/agenda/consultas.html'],
    ['/agenda/grooming.html'],
    ['/laboratorio.html'],
  ])('GET %s sin sesión redirige a /', async (route) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
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
  // Pedido explícito del usuario (BUG-6): antes cualquier URL inexistente
  // respondía un JSON crudo ({error:'No encontrado'}), pensado para un
  // cliente programático (fetch/HTMX), nunca para alguien que navegó a mano
  // a una ruta rota. Ahora depende de si hay sesión activa — igual que
  // cualquier otra página protegida (requireAuth.js), nunca se revela nada
  // del sistema sin sesión.
  it('GET /no-existe sin sesión redirige a / (nunca revela nada del sistema)', async () => {
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('AC: GET /no-existe con sesión activa muestra la página 404 del sistema, nunca JSON', async () => {
    const agent = await loginAsAdmin();

    const res = await agent.get('/no-existe');

    expect(res.status).toBe(404);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('404');
    expect(res.text).toContain('href="main.html"');
  });
});

describe('assets sensibles', () => {
  it('el esquema de base de datos (assets/sql) nunca se expone', async () => {
    const res = await request(app).get('/assets/sql/Omega-Database.sql');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

// SEC-001 (reporte de seguridad): antes el CSP estaba desactivado por
// completo (helmet({ contentSecurityPolicy: false })) porque las vistas
// usan <script> inline sin nonces. Ahora cada request genera su propio
// nonce (ver app.js) y script-src lo exige — sin 'unsafe-inline'. style-src
// sí mantiene 'unsafe-inline' (ver comentario en app.js): el cliente
// posiciona los combobox flotantes vía `elemento.style.top = ...`, algo
// que un CSP nonce-based no puede cubrir por ser un valor calculado en
// tiempo real, no contenido estático nonce-able.
describe('Content-Security-Policy', () => {
  it('GET / responde con CSP basada en nonce en script-src, sin unsafe-inline ahí', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp.match(/script-src[^;]+/)[0]).not.toMatch(/unsafe-inline/);
    // El iframe de Google Calendar (mockup de agenda.ejs/grooming.ejs) se
    // retiró junto con el calendario real por área — frame-src vuelve a
    // ser solo 'self'.
    expect(csp).toContain("frame-src 'self'");
    expect(csp).not.toContain('calendar.google.com');
  });

  it('genera un nonce distinto en cada request', async () => {
    const [a, b] = await Promise.all([request(app).get('/'), request(app).get('/')]);
    const nonceOf = (res) => res.headers['content-security-policy'].match(/nonce-([^']+)/)[1];
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  it('el nonce del header coincide con el que se renderiza en el HTML', async () => {
    const res = await request(app).get('/');
    const headerNonce = res.headers['content-security-policy'].match(/nonce-([^']+)/)[1];
    expect(res.text).toContain(`nonce="${headerNonce}"`);
  });
});

// M-06 (recomendación de seguridad, buena práctica OWASP): cámara,
// micrófono, geolocalización y pagos no se usan en ningún punto del
// sistema — se deshabilitan por completo en vez de dejarlos disponibles
// sin necesidad (ver app.js).
describe('Permissions-Policy', () => {
  it('GET / responde deshabilitando cámara, micrófono, geolocalización y pagos', async () => {
    const res = await request(app).get('/');
    expect(res.headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
  });
});

// Reporte de seguridad (hallazgo INFO): Helmet ya manda este valor por
// default sin configurar nada — se deja explícito en app.js y se cubre
// aquí para que un cambio accidental de esas opciones (o de versión de
// Helmet) no pase inadvertido. El navegador lo ignora sobre HTTP (como en
// dev/test); en producción con HTTPS real sí lo aplica.
describe('Strict-Transport-Security (HSTS)', () => {
  it('GET / responde con max-age de 1 año e includeSubDomains', async () => {
    const res = await request(app).get('/');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});
