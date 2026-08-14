// US-601: gestión de usuarios — mismo patrón que doctores.test.js/
// areas.test.js/plantillas_whatsapp.test.js (tabla estándar del sistema).
// Requiere una base de datos real migrada y sembrada (ver
// tests/integration/auth.test.js para el porqué). Solo lectura por ahora:
// alta/edición/permisos/reseteo/baja llegan en US-602/604/605/603
// respectivamente — ver usuarios.routes.js.
//
// Nota deliberada: a diferencia de otros catálogos, `usuarios` NUNCA puede
// probarse "vacío" (siempre existe al menos el admin bootstrap de US-000,
// y además la tabla la comparten TODOS los archivos de test — ver la
// memoria del proyecto sobre `session`/`usuarios` compartidas entre
// suites). Por eso cualquier assert sobre el listado usa `q` para acotar a
// los fixtures de este archivo, nunca un conteo global.
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SOLO_VER_USER = { username: 'solo.ver.usuarios.test', password: 'SoloVerTest123!' };
const SIN_PERMISOS_USER = {
  username: 'sin.permisos.usuarios.test',
  password: 'SinPermisosTest123!',
};

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

// El token para el POST de filtrado vive en el hx-headers del <form>
// renderizado por el GET (distinto del hidden #csrfToken de la pantalla de
// login) — hay que leerlo de una carga de /usuarios.html ya autenticada.
async function getUsuariosCsrfToken(agent) {
  const res = await agent.get('/usuarios.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

async function filtrarUsuarios(agent, body) {
  const csrfToken = await getUsuariosCsrfToken(agent);
  return agent.post('/usuarios.html').type('form').set('x-csrf-token', csrfToken).send(body);
}

const SUFFIX = 'QA601';

async function cleanup() {
  const fixtureIds = await db('usuarios').where('apellidos', 'like', `%${SUFFIX}`).pluck('id');
  if (fixtureIds.length) {
    await db('usuario_permisos').whereIn('usuario_id', fixtureIds).del();
    await db('usuarios').whereIn('id', fixtureIds).del();
  }

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
      apellidos: 'US601',
      correo: `${username}@omegavet.test`,
      username,
      password_hash: await bcrypt.hash(password, 4),
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
  await createTestUser(SOLO_VER_USER, ['usuarios.ver']);
  await createTestUser(SIN_PERMISOS_USER, []);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /usuarios.html', () => {
  // Nota deliberada: este describe NO inserta un doctor real en `doctores`
  // para probar la columna "Doctor vinculado" con un vínculo real — esa
  // tabla la usa también doctores.test.js, cuyo AC1/AC3 ("catálogo vacío")
  // asume que NADA MÁS inserta ahí durante la corrida (Jest corre los
  // archivos en paralelo). Insertar un doctor aquí rompería ese test de
  // forma intermitente. El caso "Sin vínculo" (sin doctor_id) sí se cubre
  // — no depende de la tabla `doctores` — y el caso "muestra el nombre del
  // doctor cuando sí hay vínculo" se verificó manualmente en vivo en su
  // lugar (ver memoria del proyecto).
  const lower = SUFFIX.toLowerCase();

  async function insertUsuario(nombre, apellidoPalabra, estatus) {
    const apellidos = `${apellidoPalabra} ${SUFFIX}`;
    const slug = apellidoPalabra.toLowerCase();
    await db('usuarios').insert({
      nombre,
      apellidos,
      correo: `${nombre.toLowerCase()}.${slug}.${lower}@omegavet.test`,
      username: `${nombre.toLowerCase()}.${slug}.${lower}`,
      password_hash: await bcrypt.hash('x', 4),
      estatus,
      creado_en: db.fn.now(),
    });
  }

  beforeAll(async () => {
    await insertUsuario('Ana', 'Activa', 'activo');
    await insertUsuario('Beto', 'Bloqueado', 'bloqueado');
    await insertUsuario('Carla', 'Temporal', 'bloqueo_temp');
    await insertUsuario('Diego', 'Inactivo', 'inactivo');
    await insertUsuario('Elena', 'ConDoctor', 'activo');
  });

  it('AC: la carga inicial (estatus=activo por defecto) lista solo activos, con nombre/username/correo/doctor/estatus', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/usuarios.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Activa ${SUFFIX}`);
    expect(res.text).toContain(`ana.activa.${lower}`);
    expect(res.text).toContain(`ana.activa.${lower}@omegavet.test`);
    expect(res.text).toContain(`ConDoctor ${SUFFIX}`);
    expect(res.text).not.toContain(`Bloqueado ${SUFFIX}`);
    expect(res.text).not.toContain(`Temporal ${SUFFIX}`);
    expect(res.text).not.toContain(`Inactivo ${SUFFIX}`);
  });

  it('AC: la columna Doctor vinculado muestra "Sin vínculo" cuando el usuario no tiene doctor_id', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarUsuarios(agent, { estatus: 'todos', q: SUFFIX });
    const filaActiva = res.text.split(`Activa ${SUFFIX}`)[1].split('</tr>')[0];

    expect(filaActiva).toContain('Sin vínculo');
  });

  it('un GET con query string a mano se ignora por completo (privacidad: nunca se lee ni se refleja)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/usuarios.html?estatus=todos&q=${SUFFIX}`);

    expect(res.text).not.toContain(`Bloqueado ${SUFFIX}`); // si leyera estatus=todos, aparecería
  });

  it('POST con estatus=todos incluye los 4 estatus', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarUsuarios(agent, { estatus: 'todos', q: SUFFIX });

    expect(res.text).toContain(`Activa ${SUFFIX}`);
    expect(res.text).toContain(`Bloqueado ${SUFFIX}`);
    expect(res.text).toContain(`Temporal ${SUFFIX}`);
    expect(res.text).toContain(`Inactivo ${SUFFIX}`);
  });

  it.each([
    ['bloqueado', `Bloqueado ${SUFFIX}`],
    ['bloqueo_temp', `Temporal ${SUFFIX}`],
    ['inactivo', `Inactivo ${SUFFIX}`],
  ])('POST con estatus=%s filtra solo ese estatus', async (estatusValor, esperado) => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarUsuarios(agent, { estatus: estatusValor, q: SUFFIX });

    expect(res.text).toContain(esperado);
    expect(res.text).not.toContain(`Activa ${SUFFIX}`);
  });

  it('POST con q=condoctor encuentra el usuario por apellidos', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarUsuarios(agent, { estatus: 'todos', q: `ConDoctor ${SUFFIX}` });

    expect(res.text).toContain(`ConDoctor ${SUFFIX}`);
    expect(res.text).not.toContain(`Activa ${SUFFIX}`);
  });

  it('POST sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.post('/usuarios.html').send({ estatus: 'todos' });

    expect(res.status).toBe(403);
  });

  it('AC: un usuario con solo usuarios.ver no ve los botones/acciones de crear/editar/permisos/resetear/eliminar', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/usuarios.html');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Nuevo usuario');
    expect(res.text).not.toContain('row-action-edit');
    expect(res.text).not.toContain('row-action-permisos');
    expect(res.text).not.toContain('row-action-reset');
    expect(res.text).not.toContain('row-action-delete');
  });

  it('AC: el ícono de Editar aparece en TODAS las filas (cualquier estatus) con usuarios.editar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarUsuarios(agent, { estatus: 'todos', q: SUFFIX });
    const filas = res.text.split('row-action-edit').length - 1;

    expect(filas).toBeGreaterThanOrEqual(5); // las 5 fixtures de este archivo
  });

  it('AC: el ícono de Dar de baja NO aparece para un usuario con estatus=inactivo, aunque haya permiso', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarUsuarios(agent, { estatus: 'todos', q: SUFFIX });
    const filaInactivo = res.text.split(`Inactivo ${SUFFIX}`)[1].split('</tr>')[0];
    const filaActiva = res.text.split(`Activa ${SUFFIX}`)[1].split('</tr>')[0];

    expect(filaInactivo).not.toContain('row-action-delete');
    expect(filaActiva).toContain('row-action-delete');
  });

  it('un usuario sin usuarios.ver es rebotado a /main.html al pedir /usuarios.html directo', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/usuarios.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin usuarios.ver recibe HX-Redirect (no un 302 normal) cuando la petición viene de HTMX', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent.post('/login').set('x-csrf-token', csrfToken).send(SIN_PERMISOS_USER);

    const res = await agent
      .post('/usuarios.html')
      .set('HX-Request', 'true')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({ estatus: 'todos' });

    expect(res.status).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/main.html');
  });

  describe('orden de la tabla por header (POST sort=&dir=)', () => {
    it('sort=nombre&dir=asc (por defecto) ordena por apellido ascendente', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarUsuarios(agent, {
        estatus: 'todos',
        q: SUFFIX,
        sort: 'nombre',
        dir: 'asc',
      });

      const idxActiva = res.text.indexOf(`Activa ${SUFFIX}`);
      const idxBloqueado = res.text.indexOf(`Bloqueado ${SUFFIX}`);
      const idxConDoctor = res.text.indexOf(`ConDoctor ${SUFFIX}`);
      expect(idxActiva).toBeLessThan(idxBloqueado);
      expect(idxBloqueado).toBeLessThan(idxConDoctor);
    });

    it('sort=nombre&dir=desc invierte el orden', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarUsuarios(agent, {
        estatus: 'todos',
        q: SUFFIX,
        sort: 'nombre',
        dir: 'desc',
      });

      const idxActiva = res.text.indexOf(`Activa ${SUFFIX}`);
      const idxConDoctor = res.text.indexOf(`ConDoctor ${SUFFIX}`);
      expect(idxConDoctor).toBeLessThan(idxActiva);
    });

    it('sort=username ordena alfabéticamente por username', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarUsuarios(agent, {
        estatus: 'todos',
        q: SUFFIX,
        sort: 'username',
        dir: 'asc',
      });

      const idxAna = res.text.indexOf(`ana.activa.${SUFFIX.toLowerCase()}`);
      const idxBeto = res.text.indexOf(`beto.bloqueado.${SUFFIX.toLowerCase()}`);
      expect(idxAna).toBeLessThan(idxBeto);
    });

    it('sort=estatus agrupa por estatus respetando la dirección', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarUsuarios(agent, {
        estatus: 'todos',
        q: SUFFIX,
        sort: 'estatus',
        dir: 'asc',
      });

      // orden alfabético de los valores: activo < bloqueado < bloqueo_temp < inactivo
      expect(res.text.indexOf(`Activa ${SUFFIX}`)).toBeLessThan(
        res.text.indexOf(`Bloqueado ${SUFFIX}`),
      );
    });

    it('una columna de orden desconocida no truena, cae al orden por nombre', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarUsuarios(agent, {
        estatus: 'todos',
        q: SUFFIX,
        sort: 'algo-invalido',
      });

      expect(res.status).toBe(200);
      expect(res.text).toContain(`Activa ${SUFFIX}`);
    });
  });
});
