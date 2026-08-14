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
      estatus: 'inactivo',
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

  it('US-106 PASO 1: cuenta dada de baja (inactivo) + credenciales correctas responde 401 con el MISMO mensaje genérico (no revela que la cuenta existe ni que está inactiva)', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: INACTIVE_USER.username, password: INACTIVE_USER.password });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Usuario o contraseña incorrectos.');
  });

  it('una cuenta inactiva no incrementa intentos_fallidos (ni siquiera es un intento real)', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: INACTIVE_USER.username, password: 'lo-que-sea' });

    const row = await db('usuarios').where({ username: INACTIVE_USER.username }).first();
    expect(row.intentos_fallidos).toBe(0);
  });
});

describe('bloqueo escalonado por intentos fallidos (US-106)', () => {
  const LOCK_USER = { username: 'bloqueo.test', password: 'BloqueoTest123!' };

  beforeEach(async () => {
    await db('usuarios').where({ username: LOCK_USER.username }).del();
    await db('usuarios').insert({
      nombre: 'Bloqueo',
      apellidos: 'Test',
      correo: 'bloqueo.test@omegavet.test',
      username: LOCK_USER.username,
      password_hash: await bcrypt.hash(LOCK_USER.password, 4),
      creado_en: db.fn.now(),
    });
  });

  afterAll(async () => {
    await db('usuarios').where({ username: LOCK_USER.username }).del();
  });

  async function intentoFallido(agent) {
    const csrfToken = await getCsrfToken(agent);
    return agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: LOCK_USER.username, password: 'contraseña-incorrecta' });
  }

  async function intentoConPasswordCorrecta(agent) {
    const csrfToken = await getCsrfToken(agent);
    return agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: LOCK_USER.username, password: LOCK_USER.password });
  }

  it('AC: al 5º intento fallido consecutivo bloquea 15 min — incluso con la contraseña correcta se rechaza, mostrando los minutos restantes', async () => {
    const agent = request.agent(app);
    for (let i = 0; i < 5; i += 1) {
      const res = await intentoFallido(agent);
      expect(res.status).toBe(401);
    }

    const row = await db('usuarios').where({ username: LOCK_USER.username }).first();
    expect(row.estatus).toBe('bloqueo_temp');
    expect(row.intentos_fallidos).toBe(5);
    expect(row.bloqueado_en).not.toBeNull();

    const res = await intentoConPasswordCorrecta(agent);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Cuenta bloqueada temporalmente');
    expect(res.body.error).toMatch(/\d+ minutos/);

    // El intento durante el bloqueo (aunque la contraseña era correcta) no
    // se evalúa ni cuenta como uno nuevo.
    const rowTrasIntento = await db('usuarios').where({ username: LOCK_USER.username }).first();
    expect(rowTrasIntento.intentos_fallidos).toBe(5);
  });

  it('AC: el bloqueo temporal expirado permite procesar el intento de nuevo (y un login exitoso resetea el contador a cero)', async () => {
    const agent = request.agent(app);
    for (let i = 0; i < 5; i += 1) await intentoFallido(agent);

    // Simula que ya pasaron los 15 minutos del bloqueo.
    await db('usuarios')
      .where({ username: LOCK_USER.username })
      .update({ bloqueado_en: new Date(Date.now() - 16 * 60_000) });

    const res = await intentoConPasswordCorrecta(agent);
    expect(res.status).toBe(200);

    const row = await db('usuarios').where({ username: LOCK_USER.username }).first();
    expect(row.estatus).toBe('activo');
    expect(row.intentos_fallidos).toBe(0);
    expect(row.bloqueado_en).toBeNull();
  });

  it('AC: un login exitoso antes de llegar a ningún umbral también resetea el contador a cero', async () => {
    const agent = request.agent(app);
    await intentoFallido(agent);
    await intentoFallido(agent);

    await intentoConPasswordCorrecta(agent);

    const row = await db('usuarios').where({ username: LOCK_USER.username }).first();
    expect(row.intentos_fallidos).toBe(0);
    expect(row.estatus).toBe('activo');
  });

  it('AC: al llegar a 10 intentos fallidos TOTALES (conservando el acumulado tras el primer bloqueo) bloquea 30 min', async () => {
    // Simula que ya se cumplió el primer ciclo (5 fallidos, bloqueo de 15
    // min ya expirado) y van 9 acumulados.
    await db('usuarios')
      .where({ username: LOCK_USER.username })
      .update({
        intentos_fallidos: 9,
        estatus: 'bloqueo_temp',
        bloqueado_en: new Date(Date.now() - 16 * 60_000),
      });

    const agent = request.agent(app);
    const res = await intentoFallido(agent); // 10º intento
    expect(res.status).toBe(401);

    const row = await db('usuarios').where({ username: LOCK_USER.username }).first();
    expect(row.estatus).toBe('bloqueo_temp');
    expect(row.intentos_fallidos).toBe(10);

    const bloqueado = await intentoConPasswordCorrecta(agent);
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.error).toContain('30 minutos');
  });

  it('AC: al llegar a 15 intentos fallidos TOTALES bloquea la cuenta de forma PERMANENTE — no se auto-desbloquea con el tiempo', async () => {
    // Simula que ya se cumplieron los dos primeros ciclos (10 acumulados,
    // bloqueo de 30 min ya expirado).
    await db('usuarios')
      .where({ username: LOCK_USER.username })
      .update({
        intentos_fallidos: 14,
        estatus: 'bloqueo_temp',
        bloqueado_en: new Date(Date.now() - 31 * 60_000),
      });

    const agent = request.agent(app);
    const res = await intentoFallido(agent); // 15º intento
    expect(res.status).toBe(401);

    const row = await db('usuarios').where({ username: LOCK_USER.username }).first();
    expect(row.estatus).toBe('bloqueado');
    expect(row.intentos_fallidos).toBe(15);

    // A diferencia de 'bloqueo_temp', 'bloqueado' nunca se reevalúa por
    // tiempo — ni aunque hayan "pasado" mil minutos.
    await db('usuarios')
      .where({ username: LOCK_USER.username })
      .update({ bloqueado_en: new Date(Date.now() - 999 * 60_000) });

    const permanente = await intentoConPasswordCorrecta(agent);
    expect(permanente.status).toBe(403);
    expect(permanente.body.error).toBe(
      'Cuenta bloqueada. Favor de contactar con el administrador.',
    );
  });

  it('un intento durante un bloqueo temporal vigente NO incrementa el contador', async () => {
    await db('usuarios').where({ username: LOCK_USER.username }).update({
      intentos_fallidos: 5,
      estatus: 'bloqueo_temp',
      bloqueado_en: new Date(),
    });

    const agent = request.agent(app);
    await intentoFallido(agent);

    const row = await db('usuarios').where({ username: LOCK_USER.username }).first();
    expect(row.intentos_fallidos).toBe(5);
  });
});

describe('cerrar sesión (US-107)', () => {
  // El sid real (la primary key que guarda connect-pg-simple) va cifrado
  // dentro del valor de la cookie que manda `Set-Cookie` en el login:
  // "omega.sid=s%3A<sid>.<firma>". Parsearlo de ahí identifica CON CERTEZA
  // la fila de ESTE agente específico — a diferencia de comparar un conteo
  // global de `session` (racy: la tabla es compartida por todos los
  // archivos de test, que Jest corre en paralelo, y otras suites hacen
  // login decenas de veces en la misma ventana) o de intentar adivinar
  // "la fila nueva que apareció" (ambiguo si más de un login concurrente
  // crea una fila nueva en el mismo instante — eso fue lo que hizo fallar
  // el primer intento de arreglo de este test).
  function extractSid(setCookieHeader) {
    const cookieValue = decodeURIComponent(setCookieHeader.split(';')[0].split('=')[1]);
    return cookieValue.replace(/^s:/, '').split('.')[0];
  }

  async function loginAgent() {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const sid = extractSid(res.headers['set-cookie'][0]);
    return { agent, sid };
  }

  it('AC1: invalida la sesión en el servidor (borra la fila en session) y redirige al login', async () => {
    const { agent, sid } = await loginAgent();
    const sessionRowBefore = await db('session').where({ sid }).first();
    expect(sessionRowBefore).toBeDefined();

    const res = await agent.get('/logout');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const sessionRowAfter = await db('session').where({ sid }).first();
    expect(sessionRowAfter).toBeUndefined();
  });

  it('AC2: tras cerrar sesión, la pantalla protegida ya no es accesible con la misma cookie (simula "Atrás")', async () => {
    const { agent } = await loginAgent();

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
    const { agent } = await loginAgent();
    // ultimo_login_en se excluye del comparativo a propósito: lo toca el
    // LOGIN, no el logout, y "admin" es el usuario fijo que usan TODAS las
    // suites — otro archivo de test corriendo en paralelo (Jest corre los
    // archivos concurrentemente) puede loguearse como admin en este mismo
    // instante y adelantar ese timestamp legítimamente. Comparar la fila
    // completa haría flaky un assert que no tiene nada que ver con logout.
    const before = await db('usuarios').where({ username: ADMIN_USERNAME }).first();
    delete before.ultimo_login_en;

    await agent.get('/logout');

    const after = await db('usuarios').where({ username: ADMIN_USERNAME }).first();
    delete after.ultimo_login_en;
    expect(after).toEqual(before);
  });
});
