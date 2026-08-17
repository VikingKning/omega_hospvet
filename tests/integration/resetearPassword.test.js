// US-605: restablecimiento administrativo de contraseña (POST
// /usuarios/:id/resetear-password) + el flujo completo de cambio
// obligatorio que dispara (login con la temporal -> sesión restringida ->
// bloqueo tras 5 intentos fallidos -> completar el cambio). Requiere una
// base de datos real (ver auth.test.js).
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUFFIX = 'QA605';

const SIN_EDITAR_USER = { username: 'sin.editar.us605.test', password: 'SinEditarTest123!' };
const OBJETIVO_PASSWORD = 'ClaveOriginal123!';

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

// Mismo mecanismo que auth.test.js#cerrar sesión: el sid real va cifrado
// dentro de la cookie que manda Set-Cookie en el login.
function extractSid(setCookieHeader) {
  const cookieValue = decodeURIComponent(setCookieHeader.split(';')[0].split('=')[1]);
  return cookieValue.replace(/^s:/, '').split('.')[0];
}

async function loginAsConSid(credentials) {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  const res = await agent.post('/login').set('x-csrf-token', csrfToken).send(credentials);
  return { agent, sid: extractSid(res.headers['set-cookie'][0]) };
}

async function getUsuariosCsrfToken(agent) {
  const res = await agent.get('/usuarios.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

async function resetearPassword(agent, id) {
  const csrfToken = await getUsuariosCsrfToken(agent);
  return agent.post(`/usuarios/${id}/resetear-password`).set('x-csrf-token', csrfToken).send({});
}

let contador = 0;
async function createTargetUser(estatus = 'activo') {
  contador += 1;
  const username = `objetivo${contador}.${SUFFIX.toLowerCase()}`;
  const [{ id }] = await db('usuarios')
    .insert({
      nombre: 'Objetivo',
      apellidos: `Reset ${SUFFIX}`,
      correo: `${username}@omegavet.test`,
      username,
      password_hash: await bcrypt.hash(OBJETIVO_PASSWORD, 4),
      estatus,
      creado_en: db.fn.now(),
    })
    .returning('id');
  return { id, username };
}

async function cleanup() {
  const fixtureIds = await db('usuarios').where('apellidos', 'like', `%${SUFFIX}`).pluck('id');
  const otherIds = await db('usuarios').whereIn('username', [SIN_EDITAR_USER.username]).pluck('id');
  const ids = [...fixtureIds, ...otherIds];
  if (ids.length) {
    await db('usuario_permisos').whereIn('usuario_id', ids).del();
    await db('usuarios').whereIn('id', ids).del();
  }
}

beforeAll(async () => {
  await cleanup();

  const [{ id: sinEditarId }] = await db('usuarios')
    .insert({
      nombre: 'Sin',
      apellidos: 'Editar US605',
      correo: `${SIN_EDITAR_USER.username}@omegavet.test`,
      username: SIN_EDITAR_USER.username,
      password_hash: await bcrypt.hash(SIN_EDITAR_USER.password, 4),
      creado_en: db.fn.now(),
    })
    .returning('id');
  const verPermiso = await db('permissions').where({ codigo: 'usuarios.ver' }).first('id');
  await db('usuario_permisos').insert({
    usuario_id: sinEditarId,
    permission_id: verPermiso.id,
    otorgado_en: db.fn.now(),
  });
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('POST /usuarios/:id/resetear-password (US-605)', () => {
  it('AC2/AC20: rechaza sin el permiso usuarios.editar', async () => {
    const objetivo = await createTargetUser();
    const agent = await loginAs(SIN_EDITAR_USER);

    const res = await resetearPassword(agent, objetivo.id);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('AC5/AC6: genera una temporal aleatoria de 16 caracteres (Decisión 24) y guarda solo su hash bcrypt', async () => {
    const objetivo = await createTargetUser();
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await resetearPassword(agent, objetivo.id);
    expect(res.status).toBe(200);

    const trigger = JSON.parse(res.headers['hx-trigger']);
    const passwordTemporal = trigger.mostrarPasswordTemporal.password;
    expect(passwordTemporal).toHaveLength(16);

    const row = await db('usuarios').where({ id: objetivo.id }).first();
    expect(row.password_hash).not.toBe(passwordTemporal);
    expect(await bcrypt.compare(passwordTemporal, row.password_hash)).toBe(true);
    // La original ya no sirve: el reset la reemplazó por completo.
    expect(await bcrypt.compare(OBJETIVO_PASSWORD, row.password_hash)).toBe(false);
  });

  it('AC7/AC8/AC19: estatus pasa a cambio_pwd, intentos_fallidos=0, bloqueado_en=null, actualizado_por/actualizado_en registrados', async () => {
    const objetivo = await createTargetUser('bloqueado');
    await db('usuarios')
      .where({ id: objetivo.id })
      .update({ intentos_fallidos: 15, bloqueado_en: new Date() });
    const admin = await db('usuarios').where({ username: ADMIN_USERNAME }).first('id');
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    await resetearPassword(agent, objetivo.id);

    const row = await db('usuarios').where({ id: objetivo.id }).first();
    expect(row.estatus).toBe('cambio_pwd');
    expect(row.intentos_fallidos).toBe(0);
    expect(row.bloqueado_en).toBeNull();
    expect(row.actualizado_por).toBe(admin.id);
    expect(row.actualizado_en).not.toBeNull();
  });

  it('AC9: si el usuario objetivo está inactivo, conserva ese estatus (no lo reactiva) aunque sí actualiza la contraseña', async () => {
    const objetivo = await createTargetUser('inactivo');
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await resetearPassword(agent, objetivo.id);
    const trigger = JSON.parse(res.headers['hx-trigger']);
    const passwordTemporal = trigger.mostrarPasswordTemporal.password;

    const row = await db('usuarios').where({ id: objetivo.id }).first();
    expect(row.estatus).toBe('inactivo');
    expect(await bcrypt.compare(passwordTemporal, row.password_hash)).toBe(true);
  });

  it('rechaza restablecer la propia contraseña, sin generar ninguna temporal', async () => {
    const admin = await db('usuarios').where({ username: ADMIN_USERNAME }).first('id');
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await resetearPassword(agent, admin.id);

    expect(res.status).toBe(200);
    expect(res.text).toContain(
      'Un usuario no puede restablecer la contraseña de su propia cuenta.',
    );
    expect(res.headers['hx-trigger']).toBeUndefined();
  });

  it('motivo de seguridad de la historia: si el usuario objetivo tenía una sesión activa, se invalida de inmediato', async () => {
    const objetivo = await createTargetUser();
    const { agent: agenteObjetivo, sid } = await loginAsConSid({
      username: objetivo.username,
      password: OBJETIVO_PASSWORD,
    });
    expect(await db('session').where({ sid }).first()).toBeDefined();

    const agenteAdmin = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    await resetearPassword(agenteAdmin, objetivo.id);

    expect(await db('session').where({ sid }).first()).toBeUndefined();
    const res = await agenteObjetivo.get('/main.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('login con contraseña temporal y cambio obligatorio (US-605)', () => {
  async function resetearYObtenerTemporal(objetivoId) {
    const agenteAdmin = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const res = await resetearPassword(agenteAdmin, objetivoId);
    const trigger = JSON.parse(res.headers['hx-trigger']);
    return trigger.mostrarPasswordTemporal.password;
  }

  it('AC13: login con la temporal correcta crea sesión restringida y redirige a /cambiar-password', async () => {
    const objetivo = await createTargetUser();
    const temporal = await resetearYObtenerTemporal(objetivo.id);

    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: objetivo.username, password: temporal });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ redirectTo: '/cambiar-password' });
  });

  it('AC14: una sesión restringida se rebota SIEMPRE a /cambiar-password, sin importar la pantalla que pida', async () => {
    const objetivo = await createTargetUser();
    const temporal = await resetearYObtenerTemporal(objetivo.id);

    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: objetivo.username, password: temporal });

    const resMain = await agent.get('/main.html');
    expect(resMain.status).toBe(302);
    expect(resMain.headers.location).toBe('/cambiar-password');

    const resUsuarios = await agent.get('/usuarios.html');
    expect(resUsuarios.status).toBe(302);
    expect(resUsuarios.headers.location).toBe('/cambiar-password');
  });

  it('una sesión restringida SÍ puede llegar a /cambiar-password y cerrar sesión', async () => {
    const objetivo = await createTargetUser();
    const temporal = await resetearYObtenerTemporal(objetivo.id);

    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: objetivo.username, password: temporal });

    const resForm = await agent.get('/cambiar-password');
    expect(resForm.status).toBe(200);
    expect(resForm.text).toContain('Debes cambiar tu contraseña');

    const resLogout = await agent.get('/logout');
    expect(resLogout.status).toBe(302);
    expect(resLogout.headers.location).toBe('/');
  });

  it('AC15/AC16: 5 intentos fallidos con la temporal bloquean directo (bloqueado), SIN pasar por bloqueo_temp', async () => {
    const objetivo = await createTargetUser();
    await resetearYObtenerTemporal(objetivo.id);

    const agent = request.agent(app);
    for (let i = 0; i < 4; i += 1) {
      const csrfToken = await getCsrfToken(agent);

      const res = await agent
        .post('/login')
        .set('x-csrf-token', csrfToken)
        .send({ username: objetivo.username, password: 'incorrecta' });
      expect(res.status).toBe(401);
    }
    let row = await db('usuarios').where({ id: objetivo.id }).first();
    expect(row.estatus).toBe('cambio_pwd');
    expect(row.intentos_fallidos).toBe(4);

    const csrfToken = await getCsrfToken(agent);
    const quinto = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .send({ username: objetivo.username, password: 'incorrecta' });
    expect(quinto.status).toBe(401);

    row = await db('usuarios').where({ id: objetivo.id }).first();
    expect(row.estatus).toBe('bloqueado');
    expect(row.intentos_fallidos).toBe(5);
  });

  it('AC18: completar el cambio con una contraseña válida activa la cuenta y entra al panel SIN volver a iniciar sesión', async () => {
    const objetivo = await createTargetUser();
    const temporal = await resetearYObtenerTemporal(objetivo.id);

    const agent = request.agent(app);
    const loginCsrf = await getCsrfToken(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', loginCsrf)
      .send({ username: objetivo.username, password: temporal });

    const formRes = await agent.get('/cambiar-password');
    const cambiarCsrf = formRes.text.match(/id="csrfToken" value="([^"]+)"/)[1];

    const cambioRes = await agent
      .post('/cambiar-password')
      .set('x-csrf-token', cambiarCsrf)
      .send({ password: 'NuevaClaveSegura123!', confirmacion: 'NuevaClaveSegura123!' });

    expect(cambioRes.status).toBe(200);
    expect(cambioRes.body).toEqual({ redirectTo: '/main.html' });

    const row = await db('usuarios').where({ id: objetivo.id }).first();
    expect(row.estatus).toBe('activo');
    expect(row.intentos_fallidos).toBe(0);
    expect(row.bloqueado_en).toBeNull();
    expect(await bcrypt.compare('NuevaClaveSegura123!', row.password_hash)).toBe(true);

    const mainRes = await agent.get('/main.html');
    expect(mainRes.status).toBe(200);
  });

  it('rechaza una contraseña nueva de menos de 8 caracteres, sin completar el cambio', async () => {
    const objetivo = await createTargetUser();
    const temporal = await resetearYObtenerTemporal(objetivo.id);

    const agent = request.agent(app);
    const loginCsrf = await getCsrfToken(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', loginCsrf)
      .send({ username: objetivo.username, password: temporal });

    const formRes = await agent.get('/cambiar-password');
    const cambiarCsrf = formRes.text.match(/id="csrfToken" value="([^"]+)"/)[1];

    const res = await agent
      .post('/cambiar-password')
      .set('x-csrf-token', cambiarCsrf)
      .send({ password: 'corta', confirmacion: 'corta' });

    expect(res.status).toBe(400);
    const row = await db('usuarios').where({ id: objetivo.id }).first();
    expect(row.estatus).toBe('cambio_pwd');
  });

  it('rechaza si la confirmación no coincide con la nueva contraseña', async () => {
    const objetivo = await createTargetUser();
    const temporal = await resetearYObtenerTemporal(objetivo.id);

    const agent = request.agent(app);
    const loginCsrf = await getCsrfToken(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', loginCsrf)
      .send({ username: objetivo.username, password: temporal });

    const formRes = await agent.get('/cambiar-password');
    const cambiarCsrf = formRes.text.match(/id="csrfToken" value="([^"]+)"/)[1];

    const res = await agent
      .post('/cambiar-password')
      .set('x-csrf-token', cambiarCsrf)
      .send({ password: 'NuevaClaveSegura123!', confirmacion: 'OtraDistinta123!' });

    expect(res.status).toBe(400);
  });
});
