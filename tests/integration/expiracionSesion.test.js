// US-108 (30 min de inactividad, ventana móvil) + US-111 (tope absoluto de
// 8h, independiente de la actividad) — ambas reglas viven en el mismo
// middleware (`requireAuth.js`), así que comparten un solo archivo de
// pruebas (mismo criterio que doctores.test.js/areas.test.js agrupando
// varias historias de un mismo feature). No se puede esperar minutos/horas
// reales en un test — se manipula directamente `session.sess.lastActivityAt`
// / `session.sess.loginAt` en Postgres (la misma tabla que usa
// connect-pg-simple) para simular el paso del tiempo, igual que
// usuarios.repository.js#darDeBaja ya lee/escribe esa columna JSON en
// producción para invalidar sesiones.
//
// Usa un usuario de prueba DEDICADO (no ADMIN_USERNAME) a propósito: Jest
// corre los archivos de test en paralelo, y varios otros archivos también
// inician sesión como `admin` — si este archivo buscara su propia fila de
// `session` filtrando solo por username, podría agarrar por error la
// sesión de OTRO archivo corriendo al mismo tiempo. Aun así, con un
// username exclusivo, CADA test de este mismo archivo vuelve a iniciar
// sesión (una fila nueva, mismo username) — por eso hay un beforeEach que
// borra cualquier fila anterior de ese username: sin esto, un test podía
// leer/mutar por error la fila de OTRO test de este mismo archivo (ambos
// con el mismo username), un bug real encontrado al escribir estos tests.
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');
const { INACTIVITY_MAX_MS, ABSOLUTE_SESSION_MAX_MS } = require('../../src/middlewares/requireAuth');

const TEST_USER = { username: 'sesion.expiracion.test', password: 'SesionExpiracionTest123!' };

async function getCsrfToken(agent) {
  const res = await agent.get('/');
  const match = res.text.match(/id="csrfToken" value="([^"]+)"/);
  return match[1];
}

async function loginAs(agent, credentials) {
  const csrfToken = await getCsrfToken(agent);
  return agent.post('/login').set('x-csrf-token', csrfToken).send(credentials);
}

// Para un POST autenticado (renovar CSRF ya con sesión activa) — a
// diferencia de getCsrfToken(), GET / redirige a /main.html cuando ya hay
// sesión, así que el token hay que sacarlo de una página YA autenticada.
async function getAuthenticatedCsrfToken(agent) {
  const res = await agent.get('/areas.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

async function deleteSessionRows() {
  await db('session').whereRaw("(sess->'user'->>'username') = ?", [TEST_USER.username]).del();
}

async function findSessionRow() {
  return db('session').whereRaw("(sess->'user'->>'username') = ?", [TEST_USER.username]).first();
}

async function setLastActivityAt(timestamp) {
  const row = await findSessionRow();
  const sess = { ...row.sess, lastActivityAt: timestamp };
  await db('session')
    .where({ sid: row.sid })
    .update({ sess: JSON.stringify(sess) });
}

async function setLoginAt(timestamp) {
  const row = await findSessionRow();
  const sess = { ...row.sess, loginAt: timestamp };
  await db('session')
    .where({ sid: row.sid })
    .update({ sess: JSON.stringify(sess) });
}

async function cleanup() {
  await deleteSessionRows();
  const usuario = await db('usuarios').where({ username: TEST_USER.username }).first('id');
  if (usuario) {
    await db('usuario_permisos').where({ usuario_id: usuario.id }).del();
    await db('usuarios').where({ id: usuario.id }).del();
  }
}

beforeAll(async () => {
  await cleanup();
  const [{ id: usuarioId }] = await db('usuarios')
    .insert({
      nombre: 'Sesion',
      apellidos: 'Expiracion Test',
      correo: `${TEST_USER.username}@omegavet.test`,
      username: TEST_USER.username,
      password_hash: await bcrypt.hash(TEST_USER.password, 4),
      estatus: 'activo',
      creado_en: db.fn.now(),
    })
    .returning('id');
  // areas.ver es necesario además de areas.crear: getAuthenticatedCsrfToken()
  // saca el token de /areas.html, y sin permiso de ver esa ruta redirige
  // antes de renderizar el hx-headers con el token (bug real encontrado
  // al escribir estos tests).
  const permisos = await db('permissions')
    .whereIn('codigo', ['areas.crear', 'areas.ver'])
    .select('id');
  await db('usuario_permisos').insert(
    permisos.map((p) => ({ usuario_id: usuarioId, permission_id: p.id, otorgado_en: db.fn.now() })),
  );
});

// Cada test inicia sesión con el MISMO username — sin esto, un test podía
// agarrar por error la fila de `session` que dejó el test anterior (bug
// real encontrado al escribir esta suite).
beforeEach(deleteSessionRows);

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('US-108: expiración por inactividad (30 min, ventana móvil)', () => {
  it('AC: más de 30 minutos de inactividad rechaza la siguiente petición autenticada', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    await setLastActivityAt(Date.now() - (INACTIVITY_MAX_MS + 1000));

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?expired=inactividad');
  });

  it('AC: al redirigir, el login muestra el mensaje exacto de expiración por inactividad', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    await setLastActivityAt(Date.now() - (INACTIVITY_MAX_MS + 1000));

    const expirado = await agent.get('/main.html'); // dispara la expiración
    const res = await agent.get(expirado.headers.location);

    expect(res.text).toContain(
      'La sesión expiró por inactividad. Favor de iniciar sesión nuevamente.',
    );
  });

  it('AC: la sesión expirada por inactividad queda destruida (no reutilizable) después del rechazo', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    await setLastActivityAt(Date.now() - (INACTIVITY_MAX_MS + 1000));

    await agent.get('/main.html'); // dispara la destrucción

    const res = await agent.get('/main.html'); // segundo intento con la misma cookie
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('AC: una petición autenticada dentro de los 30 min NO se rechaza y renueva la ventana (rolling)', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    const veintinueveMinutos = Date.now() - 29 * 60 * 1000;
    await setLastActivityAt(veintinueveMinutos);

    const res = await agent.get('/main.html');
    expect(res.status).toBe(200);

    const row = await findSessionRow();
    expect(row.sess.lastActivityAt).toBeGreaterThan(veintinueveMinutos);
  });

  it('AC: la ventana se renueva con CUALQUIER petición autenticada válida (navegar, consultar, guardar), no solo GET', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    const veintinueveMinutos = Date.now() - 29 * 60 * 1000;
    await setLastActivityAt(veintinueveMinutos);

    const csrfToken = await getAuthenticatedCsrfToken(agent);
    await agent.post('/areas.html').type('form').set('x-csrf-token', csrfToken).send({});

    const row = await findSessionRow();
    expect(row.sess.lastActivityAt).toBeGreaterThan(veintinueveMinutos);
  });

  it('AC: si la fila de `session` ya no existe físicamente (poda), se rechaza como cualquier sesión inexistente', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    await deleteSessionRows();

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    // Sin ?expired= — no hay forma de distinguir el motivo si la fila ya no existe.
    expect(res.headers.location).toBe('/');
  });

  it('AC: la fila puede seguir existiendo físicamente (su `expire` propio sin vencer) y aun así el sistema la trata como expirada por inactividad', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    await setLastActivityAt(Date.now() - (INACTIVITY_MAX_MS + 1000));

    const antes = await findSessionRow();
    expect(antes).toBeDefined(); // la fila SÍ existe todavía (maxAge de la cookie es de horas, no de 30 min)
    expect(antes.expire.getTime()).toBeGreaterThan(Date.now()); // y su propio `expire` de Postgres tampoco venció

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?expired=inactividad'); // el sistema la rechaza de todos modos
  });

  it('AC: una petición autenticada de "guardar" con la sesión ya expirada se rechaza sin procesar el cambio', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    const csrfToken = await getAuthenticatedCsrfToken(agent);
    await setLastActivityAt(Date.now() - (INACTIVITY_MAX_MS + 1000));

    const res = await agent
      .post('/areas')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ nombre: 'No debería crearse expiracionSesion' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?expired=inactividad');
    const area = await db('areas').where({ nombre: 'No debería crearse expiracionSesion' }).first();
    expect(area).toBeUndefined();
  });

  it('AC: la actividad de una sesión ("una pestaña") renueva la ventana para cualquier otra petición con la misma cookie ("otra pestaña")', async () => {
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, TEST_USER);
    const cookieHeader = loginRes.headers['set-cookie'][0].split(';')[0];

    const veintinueveMinutos = Date.now() - 29 * 60 * 1000;
    await setLastActivityAt(veintinueveMinutos);

    // "Otra pestaña": una petición nueva, sin el jar del agent, reusando
    // solo el valor de la cookie de sesión.
    const otraPestana = await request(app).get('/main.html').set('Cookie', cookieHeader);
    expect(otraPestana.status).toBe(200);

    const row = await findSessionRow();
    expect(row.sess.lastActivityAt).toBeGreaterThan(veintinueveMinutos);

    // La sesión sigue viva para la pestaña original también (misma fila).
    const res = await agent.get('/main.html');
    expect(res.status).toBe(200);
  });

  it('AC: cerrar sesión manualmente invalida de inmediato, sin importar el tiempo de inactividad restante', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    await agent.get('/main.html'); // actividad recién ahora, muy lejos de los 30 min
    await agent.get('/logout');

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('US-111: expiración por límite absoluto de sesión (8h, independiente de la actividad)', () => {
  it('AC1/AC2: alcanzar las 8h desde el login rechaza la siguiente petición, aunque haya actividad reciente', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    await agent.get('/main.html'); // actividad recién ahora (lastActivityAt fresco)
    await setLoginAt(Date.now() - (ABSOLUTE_SESSION_MAX_MS + 1000)); // pero loginAt ya venció

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?expired=absoluto');
  });

  it('AC5: al redirigir por el tope absoluto, el login muestra el mensaje exacto', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    await setLoginAt(Date.now() - (ABSOLUTE_SESSION_MAX_MS + 1000));

    const expirado = await agent.get('/main.html');
    const res = await agent.get(expirado.headers.location);

    expect(res.text).toContain('Tu sesión ha expirado. Favor de iniciar sesión nuevamente.');
  });

  it('AC3: la actividad dentro de las 8h renueva solo la ventana de inactividad, nunca el límite absoluto (loginAt)', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    const antes = await findSessionRow();
    const loginAtOriginal = antes.sess.loginAt;

    await agent.get('/main.html'); // actividad autenticada válida

    const despues = await findSessionRow();
    expect(despues.sess.loginAt).toBe(loginAtOriginal); // sin cambios
    expect(despues.sess.lastActivityAt).toBeGreaterThanOrEqual(antes.sess.lastActivityAt);
  });

  it('AC6: reingresar tras expirar por el tope absoluto crea una sesión nueva con su propio período de 8h', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    await setLoginAt(Date.now() - (ABSOLUTE_SESSION_MAX_MS + 1000));
    await agent.get('/main.html'); // dispara la expiración y destruye la sesión

    const relogin = await loginAs(agent, TEST_USER);
    expect(relogin.status).toBe(200);

    const nuevaFila = await findSessionRow();
    expect(Date.now() - nuevaFila.sess.loginAt).toBeLessThan(60 * 1000); // recién creada

    const res = await agent.get('/main.html');
    expect(res.status).toBe(200); // la nueva sesión es válida, no arrastra el vencimiento anterior
  });

  it('AC7/AC8: si el límite de inactividad se cumple antes que el absoluto, expira por inactividad', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    // Muy lejos de las 8h absolutas, pero ya pasó la ventana de 30 min.
    await setLastActivityAt(Date.now() - (INACTIVITY_MAX_MS + 1000));

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?expired=inactividad'); // no 'absoluto'
  });

  it('AC9: actividad suficiente para evitar la expiración por inactividad, pero al cumplirse las 8h expira por el tope absoluto', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    await setLastActivityAt(Date.now() - 5 * 60 * 1000); // 5 min, muy lejos de los 30
    await setLoginAt(Date.now() - (ABSOLUTE_SESSION_MAX_MS + 1000));

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?expired=absoluto');
  });

  it('AC10: una sesión ya expirada por el tope absoluto queda destruida (no se renueva ni permite acceso en peticiones posteriores)', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);
    await setLoginAt(Date.now() - (ABSOLUTE_SESSION_MAX_MS + 1000));

    await agent.get('/main.html'); // dispara la destrucción

    const res = await agent.get('/main.html'); // segundo intento con la misma cookie
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/'); // ya no existe fila que leer, sin ?expired=
  });

  it('AC11: todas las pestañas con la misma sesión quedan sujetas a la misma expiración por tope absoluto', async () => {
    const agent = request.agent(app);
    const loginRes = await loginAs(agent, TEST_USER);
    const cookieHeader = loginRes.headers['set-cookie'][0].split(';')[0];

    await setLoginAt(Date.now() - (ABSOLUTE_SESSION_MAX_MS + 1000));

    // "Otra pestaña": una petición nueva, sin el jar del agent, con la misma cookie de sesión.
    const otraPestana = await request(app).get('/main.html').set('Cookie', cookieHeader);
    expect(otraPestana.status).toBe(302);
    expect(otraPestana.headers.location).toBe('/?expired=absoluto');

    // La pestaña original también quedó expirada (misma fila, ya destruida).
    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
  });

  it('AC12: cerrar sesión manualmente antes de las 8h invalida de inmediato y el tope absoluto pendiente deja de tener efecto', async () => {
    const agent = request.agent(app);
    await loginAs(agent, TEST_USER);

    await agent.get('/logout');

    const res = await agent.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/'); // sin ?expired= — la sesión ya no existe, no "expiró"
  });
});
