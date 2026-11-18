const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');
const { AVATARES_VALIDOS } = require('../../src/config/avatares');

const PASSWORD = 'ClaveDePruebaAvatarOriginal2026!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
let secuencia = 0;
let usuarios = [];
let sesiones = [];

async function entrar({ avatar = 'icon_cat', estatus = 'activo' } = {}) {
  const username = `avatar.sesion.test.${++secuencia}`;
  const [usuario] = await db('usuarios')
    .insert({
      nombre: 'Avatar',
      apellidos: 'Prueba',
      correo: `${username}@omegavet.test`,
      username,
      password_hash: PASSWORD_HASH,
      estatus,
      avatar,
      creado_en: db.fn.now(),
    })
    .returning('id');
  usuarios.push(usuario.id);
  const agent = request.agent(app);
  const inicio = await agent.get('/');
  const csrf = inicio.text.match(/id="csrfToken" value="([^"]+)"/)[1];
  const login = await agent
    .post('/login')
    .set('x-csrf-token', csrf)
    .send({ username, password: PASSWORD });
  expect(login.status).toBe(200);
  const cookie = login.headers['set-cookie'].find((valor) => valor.startsWith('omega.sid='));
  const sid = decodeURIComponent(cookie.split(';')[0].split('=')[1])
    .replace(/^s:/, '')
    .split('.')[0];
  sesiones.push(sid);
  return { agent, sid, usuario, login };
}

async function cambiarAvatarSesion(sid, avatar) {
  const { sess } = await db('session').where({ sid }).first();
  if (avatar === undefined) delete sess.user.avatar;
  else sess.user.avatar = avatar;
  await db('session')
    .where({ sid })
    .update({ sess: JSON.stringify(sess) });
}

afterEach(async () => {
  await db('session').whereIn('sid', sesiones).del();
  await db('usuarios').whereIn('id', usuarios).del();
  sesiones = [];
  usuarios = [];
});
afterAll(async () => Promise.all([db.destroy(), sessionStore.close()]));

it.each(AVATARES_VALIDOS)('conserva el avatar %s y su imagen está disponible', async (avatar) => {
  const { agent } = await entrar({ avatar });
  const panel = await agent.get('/main.html');
  expect(panel.status).toBe(200);
  expect(panel.text).toContain(`assets/imgs/${avatar}.png`);
  const imagen = await agent.get(`/assets/imgs/${avatar}.png`);
  expect(imagen.status).toBe(200);
  expect(imagen.headers['content-type']).toMatch(/image\/png/);
});

it('conserva el avatar elegido al entrar con contraseña temporal y completar el cambio obligatorio', async () => {
  const { agent, sid, login } = await entrar({ estatus: 'cambio_pwd', avatar: 'icon_cat' });
  expect(login.body.redirectTo).toBe('/cambiar-password');
  const antes = await db('session').where({ sid }).first();
  expect(antes.sess.user.avatar).toBe('icon_cat');
  expect(antes.sess.user.permissions).toEqual([]);
  const formulario = await agent.get('/cambiar-password');
  const csrf = formulario.text.match(/id="csrfToken" value="([^"]+)"/)[1];
  const password = 'NuevaClaveParaAvatarMuySegura2026!';
  const cambio = await agent
    .post('/cambiar-password')
    .set('x-csrf-token', csrf)
    .send({ password, confirmacion: password });
  expect(cambio.status).toBe(200);
  expect(cambio.body.redirectTo).toBe('/main.html');
  const panel = await agent.get('/main.html');
  expect(panel.status).toBe(200);
  expect(panel.text).toContain('assets/imgs/icon_cat.png');
  expect(panel.text).not.toContain('assets/imgs/.png');
  const despues = await db('session').where({ sid }).first();
  expect(despues.sess.user.avatar).toBe('icon_cat');
  expect(despues.sess.user.mustChangePassword).toBeUndefined();
});

it('una sesión anterior sin avatar recibe el ícono Omega y lo conserva al navegar', async () => {
  const { agent, sid } = await entrar();
  await cambiarAvatarSesion(sid, undefined);
  for (let intento = 0; intento < 2; intento += 1) {
    const panel = await agent.get('/main.html');
    expect(panel.status).toBe(200);
    expect(panel.text).toContain('assets/imgs/icon_hospvet.png');
    expect(panel.text).not.toContain('assets/imgs/.png');
  }
  expect((await db('session').where({ sid }).first()).sess.user.avatar).toBe('icon_hospvet');
});

it('protege también la página 404 cuando una sesión tiene un avatar inválido', async () => {
  const { agent, sid } = await entrar();
  await cambiarAvatarSesion(sid, 'avatar-inexistente');
  const pagina = await agent.get('/pagina-inexistente-prueba-avatar');
  expect(pagina.status).toBe(404);
  expect(pagina.text).toContain('assets/imgs/icon_hospvet.png');
  expect(pagina.text).not.toContain('avatar-inexistente.png');
});

it('un avatar vacío guardado en el perfil tiene respaldo y una opción marcada en Mi perfil', async () => {
  const { agent } = await entrar({ avatar: '' });
  const panel = await agent.get('/main.html');
  expect(panel.text).toContain('assets/imgs/icon_hospvet.png');
  const perfil = await agent.get('/mi-perfil.html');
  expect(perfil.status).toBe(200);
  expect(perfil.text).toMatch(/<input[^>]*name="avatar"[^>]*value="icon_hospvet"[^>]*checked/);
});
