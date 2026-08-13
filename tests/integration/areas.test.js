// US-609: catálogo de áreas — mismo patrón que doctores.test.js (tabla
// estándar del sistema). Requiere una base de datos real migrada y
// sembrada (ver tests/integration/auth.test.js para el porqué).
//
// Nota deliberada: a diferencia de doctores.test.js, este archivo NO prueba
// el escenario "catálogo totalmente vacío" a nivel de integración — la
// tabla `areas` también la usa doctores.test.js (crea su propia área de
// prueba), y Jest corre los archivos de test en paralelo contra la misma
// BD, así que "areas está vacía" no es un estado que se pueda garantizar
// sin una condición de carrera entre archivos (mismo tipo de problema ya
// documentado para `session`/`usuarios`, ver memoria del proyecto). Esa
// lógica (catalogoVacio) ya está cubierta sin ese riesgo en
// tests/unit/areas.service.test.js, con el repository mockeado.
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SOLO_VER_USER = { username: 'solo.ver.areas.test', password: 'SoloVerTest123!' };
const SIN_PERMISOS_USER = { username: 'sin.permisos.areas.test', password: 'SinPermisosTest123!' };

async function getCsrfToken(agent) {
  const res = await agent.get('/');
  const match = res.text.match(/id="csrfToken" value="([^"]+)"/);
  return match[1];
}

async function loginAs(credentials) {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/login').set('x-csrf-token', csrfToken).send(credentials);
  return agent;
}

async function getAreasCsrfToken(agent) {
  const res = await agent.get('/areas.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

// HTMX manda el <form> con la codificación por defecto de un form HTML
// (application/x-www-form-urlencoded), no JSON — .type('form') replica
// eso en vez de dejar que supertest mande JSON por default (ver el bug
// real de doctores.controller.js que esto habría atrapado desde el día 1).
async function filtrarAreas(agent, body) {
  const csrfToken = await getAreasCsrfToken(agent);
  return agent.post('/areas.html').type('form').set('x-csrf-token', csrfToken).send(body);
}

const SUFFIX = 'QA609';
async function cleanup() {
  await db('areas').where('slug', 'like', `%-${SUFFIX.toLowerCase()}`).del();

  const usernames = [SOLO_VER_USER.username, SIN_PERMISOS_USER.username];
  const usuarioIds = await db('usuarios').whereIn('username', usernames).pluck('id');
  if (usuarioIds.length) {
    await db('usuario_permisos').whereIn('usuario_id', usuarioIds).del();
    await db('usuarios').whereIn('id', usuarioIds).del();
  }
}

async function createTestUser({ username, password }, permissionCodes) {
  const [{ id: usuarioId }] = await db('usuarios')
    .insert({
      nombre: 'Test',
      apellidos: 'US609',
      correo: `${username}@omegavet.test`,
      username,
      password_hash: await bcrypt.hash(password, 4),
      activo: true,
      creado_en: db.fn.now(),
    })
    .returning('id');

  if (permissionCodes.length) {
    const permisos = await db('permissions').whereIn('codigo', permissionCodes).select('id');
    await db('usuario_permisos').insert(
      permisos.map((p) => ({
        usuario_id: usuarioId,
        permission_id: p.id,
        otorgado_en: db.fn.now(),
      })),
    );
  }
}

beforeAll(async () => {
  await cleanup();
  await createTestUser(SOLO_VER_USER, ['areas.ver']);
  await createTestUser(SIN_PERMISOS_USER, []);

  await db('areas').insert({
    nombre: `Cardiología ${SUFFIX}`,
    slug: `cardiologia-${SUFFIX.toLowerCase()}`,
    activo: true,
    creado_en: db.fn.now(),
  });
  await db('areas').insert({
    nombre: `Dermatología ${SUFFIX}`,
    slug: `dermatologia-${SUFFIX.toLowerCase()}`,
    activo: true,
    creado_en: db.fn.now(),
  });
  await db('areas').insert({
    nombre: `Radiología ${SUFFIX}`,
    slug: `radiologia-${SUFFIX.toLowerCase()}`,
    activo: false,
    creado_en: db.fn.now(),
  });
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /areas.html', () => {
  it('AC: la carga inicial lista solo activas, con nombre/slug/estado y sin la inactiva', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/areas.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Cardiología ${SUFFIX}`);
    expect(res.text).toContain(`cardiologia-${SUFFIX.toLowerCase()}`);
    expect(res.text).toContain(`Dermatología ${SUFFIX}`);
    expect(res.text).not.toContain(`Radiología ${SUFFIX}`); // inactiva, no aparece por defecto
  });

  it('un GET con query string a mano se ignora por completo (privacidad: nunca se lee ni se refleja)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/areas.html?estado=todos&q=${SUFFIX}`);

    expect(res.text).not.toContain(`Radiología ${SUFFIX}`); // si leyera estado=todos, aparecería
  });

  it('POST con estado=todos incluye también a las inactivas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarAreas(agent, { estado: 'todos' });

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Radiología ${SUFFIX}`);
  });

  it('POST con q=dermat encuentra el área por nombre o slug', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarAreas(agent, { q: 'dermat' });

    expect(res.text).toContain(`Dermatología ${SUFFIX}`);
    expect(res.text).not.toContain(`Cardiología ${SUFFIX}`);
  });

  it('POST sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.post('/areas.html').send({ estado: 'todos' });

    expect(res.status).toBe(403);
  });

  it('un usuario con solo areas.ver no ve los botones de crear/editar/eliminar', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/areas.html');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Nueva área');
    expect(res.text).not.toContain('row-action-edit');
    expect(res.text).not.toContain('row-action-delete');
  });

  it('un usuario sin areas.ver es rebotado a /main.html al pedir /areas.html directo', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/areas.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin areas.ver recibe HX-Redirect (no un 302 normal) cuando la petición viene de HTMX', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent.post('/login').set('x-csrf-token', csrfToken).send(SIN_PERMISOS_USER);

    const res = await agent
      .post('/areas.html')
      .set('HX-Request', 'true')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({ estado: 'todos' });

    expect(res.status).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/main.html');
  });

  describe('orden de la tabla por header (POST sort=&dir=)', () => {
    it('sort=nombre&dir=asc (por defecto) ordena alfabéticamente', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, { estado: 'todos', sort: 'nombre', dir: 'asc' });

      const idxCardio = res.text.indexOf(`Cardiología ${SUFFIX}`);
      const idxDermato = res.text.indexOf(`Dermatología ${SUFFIX}`);
      const idxRadio = res.text.indexOf(`Radiología ${SUFFIX}`);
      expect(idxCardio).toBeLessThan(idxDermato);
      expect(idxDermato).toBeLessThan(idxRadio);
    });

    it('sort=nombre&dir=desc invierte el orden', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, { estado: 'todos', sort: 'nombre', dir: 'desc' });

      const idxCardio = res.text.indexOf(`Cardiología ${SUFFIX}`);
      const idxDermato = res.text.indexOf(`Dermatología ${SUFFIX}`);
      const idxRadio = res.text.indexOf(`Radiología ${SUFFIX}`);
      expect(idxRadio).toBeLessThan(idxDermato);
      expect(idxDermato).toBeLessThan(idxCardio);
    });

    it('sort=estado agrupa por activa/inactiva respetando la dirección', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const asc = await filtrarAreas(agent, { estado: 'todos', sort: 'estado', dir: 'asc' });
      const desc = await filtrarAreas(agent, { estado: 'todos', sort: 'estado', dir: 'desc' });

      // activo=false ordena antes que activo=true en ascendente, y al revés en descendente.
      expect(asc.text.indexOf(`Radiología ${SUFFIX}`)).toBeLessThan(
        asc.text.indexOf(`Cardiología ${SUFFIX}`),
      );
      expect(desc.text.indexOf(`Cardiología ${SUFFIX}`)).toBeLessThan(
        desc.text.indexOf(`Radiología ${SUFFIX}`),
      );
    });

    it('sort=slug ordena por slug', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, { estado: 'todos', sort: 'slug', dir: 'asc' });

      const idxCardio = res.text.indexOf(`cardiologia-${SUFFIX.toLowerCase()}`);
      const idxDermato = res.text.indexOf(`dermatologia-${SUFFIX.toLowerCase()}`);
      const idxRadio = res.text.indexOf(`radiologia-${SUFFIX.toLowerCase()}`);
      expect(idxCardio).toBeLessThan(idxDermato);
      expect(idxDermato).toBeLessThan(idxRadio);
    });

    it('una columna de orden desconocida no truena, cae al orden por nombre', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, { estado: 'todos', sort: 'algo-invalido' });

      expect(res.status).toBe(200);
      expect(res.text).toContain(`Cardiología ${SUFFIX}`);
    });
  });
});
