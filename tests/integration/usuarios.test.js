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
// US-602: usuarios con exactamente uno de los dos permisos de escritura,
// para probar el AC "editar sin crear (o viceversa) se rechaza, aunque el
// formulario sea el mismo".
const SOLO_CREAR_USER = { username: 'solo.crear.usuarios.test', password: 'SoloCrearTest123!' };
const SOLO_EDITAR_USER = { username: 'solo.editar.usuarios.test', password: 'SoloEditarTest123!' };
// US-604: crear/editar CON usuarios.permisos, para ver y guardar la matriz.
const CON_PERMISOS_USER = {
  username: 'con.permisos.usuarios.test',
  password: 'ConPermisosTest123!',
};
// US-603: usuarios.eliminar en solitario, para probar la baja sin arrastrar
// usuarios.crear/editar/permisos de otros fixtures.
const SOLO_ELIMINAR_USER = {
  username: 'solo.eliminar.usuarios.test',
  password: 'SoloEliminarTest123!',
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

// US-603: para probar la invalidación de sesión al dar de baja hace falta
// identificar CON CERTEZA la fila de `session` de un agente específico (la
// tabla es compartida por todos los archivos de test, que Jest corre en
// paralelo) — mismo mecanismo ya usado en auth.test.js#cerrar sesión: el sid
// real va cifrado dentro del valor de la cookie `omega.sid` que manda
// Set-Cookie en el login.
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

  const usernames = [
    SOLO_VER_USER.username,
    SIN_PERMISOS_USER.username,
    SOLO_CREAR_USER.username,
    SOLO_EDITAR_USER.username,
    CON_PERMISOS_USER.username,
    SOLO_ELIMINAR_USER.username,
  ];
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

describe('GET /usuarios/nuevo y GET /usuarios/:id/editar (US-602 — formulario)', () => {
  let usuarioId;

  beforeAll(async () => {
    await createTestUser(SOLO_CREAR_USER, ['usuarios.ver', 'usuarios.crear']);
    await createTestUser(SOLO_EDITAR_USER, ['usuarios.ver', 'usuarios.editar']);

    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Formulario',
        apellidos: `Precarga ${SUFFIX}`,
        correo: `formulario.precarga.${SUFFIX.toLowerCase()}@omegavet.test`,
        telefono: '555-0000',
        username: `formulario.precarga.${SUFFIX.toLowerCase()}`,
        password_hash: await bcrypt.hash('x', 4),
        estatus: 'bloqueado',
        creado_en: db.fn.now(),
      })
      .returning('id');
    usuarioId = usuario.id;
  });

  it('AC: el formulario de alta abre vacío, con título "Nuevo usuario", sin campo Estatus, y con el de Contraseña', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/usuarios/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nuevo usuario');
    expect(res.text).not.toContain('Editar usuario');
    expect(res.text).toContain('name="password"');
    expect(res.text).not.toContain('name="estatus"');
  });

  it('AC: el formulario de edición trae los campos precargados, título "Editar usuario", SIN campo de contraseña', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/usuarios/${usuarioId}/editar`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Editar usuario');
    expect(res.text).toContain('value="Formulario"');
    expect(res.text).toContain(`value="Precarga ${SUFFIX}"`);
    expect(res.text).toContain(`value="formulario.precarga.${SUFFIX.toLowerCase()}@omegavet.test"`);
    expect(res.text).toContain('value="555-0000"');
    expect(res.text).toContain('name="estatus"');
    expect(res.text).not.toContain('name="password"');
  });

  it('un usuario sin usuarios.crear no puede abrir el formulario de alta', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent.get('/usuarios/nuevo');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin usuarios.editar no puede abrir el formulario de edición', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await agent.get(`/usuarios/${usuarioId}/editar`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /usuarios y PUT /usuarios/:id (US-602 — alta y edición)', () => {
  const lower = SUFFIX.toLowerCase();

  async function crearUsuario(agent, overrides = {}) {
    const csrfToken = await getUsuariosCsrfToken(agent);
    const body = {
      nombre: 'Alta',
      apellidos: `Nueva ${SUFFIX}`,
      correo: `alta.nueva.${lower}@omegavet.test`,
      telefono: '555-1111',
      username: `alta.nueva.${lower}`,
      password: 'ContraseñaSegura1',
      ...overrides,
    };
    return agent.post('/usuarios').type('form').set('x-csrf-token', csrfToken).send(body);
  }

  async function editarUsuario(agent, id, overrides = {}) {
    const csrfToken = await getUsuariosCsrfToken(agent);
    const body = {
      nombre: 'Editado',
      apellidos: `Editada ${SUFFIX}`,
      correo: `editado.editada.${lower}@omegavet.test`,
      username: `editado.editada.${lower}`,
      estatus: 'activo',
      ...overrides,
    };
    return agent.put(`/usuarios/${id}`).type('form').set('x-csrf-token', csrfToken).send(body);
  }

  it('AC: alta sin id crea el usuario con estatus=activo, intentos_fallidos=0, bloqueado_en=null, creado_por/creado_en, y hace el swap out-of-band de la tabla', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await crearUsuario(agent, {
      apellidos: `AltaReal ${SUFFIX}`,
      correo: `alta.real.${lower}@omegavet.test`,
      username: `alta.real.${lower}`,
    });

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeUsuarioModal');
    expect(res.text).toContain('hx-swap-oob="true"');

    const row = await db('usuarios').where('username', `alta.real.${lower}`).first();
    expect(row).toBeDefined();
    expect(row.estatus).toBe('activo');
    expect(row.intentos_fallidos).toBe(0);
    expect(row.bloqueado_en).toBeNull();
    expect(row.creado_por).not.toBeNull();
    expect(row.creado_en).not.toBeNull();
  });

  it('AC: la contraseña se guarda únicamente como hash de bcrypt, nunca en texto plano', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `hash.check.${lower}`;

    await crearUsuario(agent, {
      apellidos: `HashCheck ${SUFFIX}`,
      correo: `hash.check.${lower}@omegavet.test`,
      username,
      password: 'ContraseñaSegura1',
    });

    const row = await db('usuarios').where({ username }).first();
    expect(row.password_hash).not.toBe('ContraseñaSegura1');
    expect(row.password_hash).not.toContain('ContraseñaSegura1');
    expect(await bcrypt.compare('ContraseñaSegura1', row.password_hash)).toBe(true);
  });

  it('un nombre vacío muestra el error y no crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await crearUsuario(agent, {
      nombre: '   ',
      username: `sinnombre.${lower}`,
      correo: `sinnombre.${lower}@omegavet.test`,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nombre es obligatorio');
    expect(res.headers['hx-trigger']).toBeUndefined();

    const row = await db('usuarios').where('username', `sinnombre.${lower}`).first();
    expect(row).toBeUndefined();
  });

  it('AC: una contraseña de menos de 8 caracteres no permite guardar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await crearUsuario(agent, {
      username: `passcorta.${lower}`,
      correo: `passcorta.${lower}@omegavet.test`,
      password: '1234567',
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('contraseña debe tener al menos 8 caracteres');

    const row = await db('usuarios').where('username', `passcorta.${lower}`).first();
    expect(row).toBeUndefined();
  });

  it('AC: un username duplicado (aunque el otro registro esté inactivo) muestra el error y no crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `duplicado.${lower}`;
    await db('usuarios').insert({
      nombre: 'Original',
      apellidos: `Duplicado ${SUFFIX}`,
      correo: `original.duplicado.${lower}@omegavet.test`,
      username,
      password_hash: await bcrypt.hash('x', 4),
      estatus: 'inactivo',
      creado_en: db.fn.now(),
    });

    const res = await crearUsuario(agent, {
      apellidos: `Intento ${SUFFIX}`,
      correo: `intento.duplicado.${lower}@omegavet.test`,
      username,
    });

    expect(res.status).toBe(200);
    // US-604 (sexta iteración): el mensaje ahora trae el siguiente
    // consecutivo disponible ya calculado (ver describe dedicado más abajo:
    // "conflicto de username al guardar recalcula el consecutivo y avisa").
    expect(res.text).toContain(`Se ha actualizado a &#34;${username}.2&#34;`);
    expect(res.headers['hx-trigger']).toBeUndefined();

    const count = await db('usuarios').where({ username }).count('* as total').first();
    expect(Number(count.total)).toBe(1);
  });

  it('AC: un correo duplicado (aunque el otro registro esté bloqueado) muestra el error y no crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const correo = `correo.duplicado.${lower}@omegavet.test`;
    await db('usuarios').insert({
      nombre: 'Original',
      apellidos: `CorreoDup ${SUFFIX}`,
      correo,
      username: `original.correodup.${lower}`,
      password_hash: await bcrypt.hash('x', 4),
      estatus: 'bloqueado',
      creado_en: db.fn.now(),
    });

    const res = await crearUsuario(agent, {
      apellidos: `IntentoCorreo ${SUFFIX}`,
      correo,
      username: `intento.correodup.${lower}`,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('El correo ya está registrado.');

    const count = await db('usuarios').where({ correo }).count('* as total').first();
    expect(Number(count.total)).toBe(1);
  });

  it('AC: la edición actualiza los datos generales sin tocar la contraseña', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `editar.original.${lower}`;
    await crearUsuario(agent, {
      apellidos: `EditarOriginal ${SUFFIX}`,
      correo: `editar.original.${lower}@omegavet.test`,
      username,
    });
    const original = await db('usuarios').where({ username }).first();

    const res = await editarUsuario(agent, original.id, {
      nombre: 'Renombrado',
      apellidos: `Renombrada ${SUFFIX}`,
      correo: `renombrado.${lower}@omegavet.test`,
      username: `renombrado.${lower}`,
      estatus: 'activo',
    });

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeUsuarioModal');

    const actualizado = await db('usuarios').where({ id: original.id }).first();
    expect(actualizado.nombre).toBe('Renombrado');
    expect(actualizado.correo).toBe(`renombrado.${lower}@omegavet.test`);
    expect(actualizado.password_hash).toBe(original.password_hash); // no se tocó
    expect(actualizado.actualizado_por).not.toBeNull();
    expect(actualizado.actualizado_en).not.toBeNull();
  });

  it('AC: editar sin cambiar el propio username/correo no choca consigo mismo', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `sincambios.${lower}`;
    const correo = `sincambios.${lower}@omegavet.test`;
    await crearUsuario(agent, { apellidos: `SinCambios ${SUFFIX}`, correo, username });
    const usuario = await db('usuarios').where({ username }).first();

    const res = await editarUsuario(agent, usuario.id, {
      nombre: 'SinCambios',
      apellidos: `SinCambios ${SUFFIX}`,
      correo,
      username,
      estatus: 'activo',
    });

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeUsuarioModal');
  });

  it('AC: editar a un username usado por OTRO registro muestra el error y no actualiza', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    await crearUsuario(agent, {
      apellidos: `Ocupado ${SUFFIX}`,
      correo: `ocupado.${lower}@omegavet.test`,
      username: `ocupado.${lower}`,
    });
    await crearUsuario(agent, {
      apellidos: `PorEditar ${SUFFIX}`,
      correo: `poreditar.${lower}@omegavet.test`,
      username: `poreditar.${lower}`,
    });
    const porEditar = await db('usuarios').where('username', `poreditar.${lower}`).first();

    const res = await editarUsuario(agent, porEditar.id, {
      nombre: 'PorEditar',
      apellidos: `PorEditar ${SUFFIX}`,
      correo: `poreditar.${lower}@omegavet.test`,
      username: `ocupado.${lower}`,
      estatus: 'activo',
    });

    expect(res.status).toBe(200);
    // US-604 (sexta iteración): mensaje con el consecutivo ya calculado.
    expect(res.text).toContain(`Se ha actualizado a &#34;ocupado.${lower}.2&#34;`);

    const sinCambios = await db('usuarios').where({ id: porEditar.id }).first();
    expect(sinCambios.username).toBe(`poreditar.${lower}`);
  });

  it('AC: cambiar el estatus de bloqueado a activo hace el desbloqueo administrativo (intentos_fallidos=0, bloqueado_en=null)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Bloqueada',
        apellidos: `Desbloquear ${SUFFIX}`,
        correo: `desbloquear.${lower}@omegavet.test`,
        username: `desbloquear.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        estatus: 'bloqueado',
        intentos_fallidos: 15,
        bloqueado_en: db.fn.now(),
        creado_en: db.fn.now(),
      })
      .returning('id');

    const res = await editarUsuario(agent, usuario.id, {
      nombre: 'Bloqueada',
      apellidos: `Desbloquear ${SUFFIX}`,
      correo: `desbloquear.${lower}@omegavet.test`,
      username: `desbloquear.${lower}`,
      estatus: 'activo',
    });

    expect(res.status).toBe(200);
    const actualizado = await db('usuarios').where({ id: usuario.id }).first();
    expect(actualizado.estatus).toBe('activo');
    expect(actualizado.intentos_fallidos).toBe(0);
    expect(actualizado.bloqueado_en).toBeNull();
  });

  it('AC: cambiar el estatus de inactivo a activo reactiva el mismo registro (no crea uno nuevo)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `reactivar.${lower}`;
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Inactiva',
        apellidos: `Reactivar ${SUFFIX}`,
        correo: `reactivar.${lower}@omegavet.test`,
        username,
        password_hash: await bcrypt.hash('x', 4),
        estatus: 'inactivo',
        desactivado_por: 1,
        desactivado_en: db.fn.now(),
        creado_en: db.fn.now(),
      })
      .returning('id');

    const res = await editarUsuario(agent, usuario.id, {
      nombre: 'Inactiva',
      apellidos: `Reactivar ${SUFFIX}`,
      correo: `reactivar.${lower}@omegavet.test`,
      username,
      estatus: 'activo',
    });

    expect(res.status).toBe(200);
    const todas = await db('usuarios').where({ username });
    expect(todas).toHaveLength(1); // sigue siendo el mismo registro, no hay uno nuevo
    expect(todas[0].id).toBe(usuario.id);
    expect(todas[0].estatus).toBe('activo');
    expect(todas[0].desactivado_por).toBeNull();
    expect(todas[0].desactivado_en).toBeNull();
  });

  it('AC: cambiar el estatus de bloqueo_temp a activo establece intentos_fallidos=0 y bloqueado_en=null', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Temporal',
        apellidos: `DesbloquearTemp ${SUFFIX}`,
        correo: `desbloqueartemp.${lower}@omegavet.test`,
        username: `desbloqueartemp.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        estatus: 'bloqueo_temp',
        intentos_fallidos: 5,
        bloqueado_en: db.fn.now(),
        creado_en: db.fn.now(),
      })
      .returning('id');

    const res = await editarUsuario(agent, usuario.id, {
      nombre: 'Temporal',
      apellidos: `DesbloquearTemp ${SUFFIX}`,
      correo: `desbloqueartemp.${lower}@omegavet.test`,
      username: `desbloqueartemp.${lower}`,
      estatus: 'activo',
    });

    expect(res.status).toBe(200);
    const actualizado = await db('usuarios').where({ id: usuario.id }).first();
    expect(actualizado.intentos_fallidos).toBe(0);
    expect(actualizado.bloqueado_en).toBeNull();
  });

  it('POST /usuarios sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent
      .post('/usuarios')
      .type('form')
      .send({
        nombre: 'Sin',
        apellidos: `Csrf ${SUFFIX}`,
        correo: `sincsrf.${lower}@omegavet.test`,
        username: `sincsrf.${lower}`,
        password: 'ContraseñaSegura1',
      });

    expect(res.status).toBe(403);
  });

  it('AC: un usuario con usuarios.editar pero SIN usuarios.crear no puede dar de alta, aunque el formulario sea el mismo', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent
      .post('/usuarios')
      .type('form')
      .send({
        nombre: 'Sin',
        apellidos: `PermisoCrear ${SUFFIX}`,
        correo: `sinpermisocrear.${lower}@omegavet.test`,
        username: `sinpermisocrear.${lower}`,
        password: 'ContraseñaSegura1',
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const row = await db('usuarios').where('username', `sinpermisocrear.${lower}`).first();
    expect(row).toBeUndefined();
  });

  it('AC: un usuario con usuarios.crear pero SIN usuarios.editar no puede editar, aunque el formulario sea el mismo', async () => {
    const adminAgent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `sinpermisoeditar.${lower}`;
    await crearUsuario(adminAgent, {
      apellidos: `SinPermisoEditar ${SUFFIX}`,
      correo: `sinpermisoeditar.${lower}@omegavet.test`,
      username,
    });
    const usuario = await db('usuarios').where({ username }).first();

    const agent = await loginAs(SOLO_CREAR_USER);
    const res = await agent
      .put(`/usuarios/${usuario.id}`)
      .type('form')
      .send({
        nombre: 'Modificado',
        apellidos: `SinPermisoEditar ${SUFFIX}`,
        correo: `sinpermisoeditar.${lower}@omegavet.test`,
        username,
        estatus: 'activo',
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const sinCambios = await db('usuarios').where({ id: usuario.id }).first();
    expect(sinCambios.nombre).toBe('Alta'); // no se tocó (sigue el nombre con el que se creó)
  });
});

describe('US-604 — matriz de permisos en el formulario de usuarios', () => {
  const lower = SUFFIX.toLowerCase();

  async function permisoId(codigo) {
    const row = await db('permissions').where({ codigo }).first('id');
    return row.id;
  }

  async function crearConPermisos(agent, overrides = {}, permisoIds = []) {
    const csrfToken = await getUsuariosCsrfToken(agent);
    const body = {
      nombre: 'ConPermisos',
      apellidos: `Alta ${SUFFIX}`,
      correo: `conpermisos.alta.${lower}@omegavet.test`,
      username: `conpermisos.alta.${lower}`,
      password: 'ContraseñaSegura1',
      permisosSeccion: '1',
      permisos: permisoIds.map(String),
      ...overrides,
    };
    return agent.post('/usuarios').type('form').set('x-csrf-token', csrfToken).send(body);
  }

  async function editarConPermisos(agent, id, overrides = {}, permisoIds = []) {
    const csrfToken = await getUsuariosCsrfToken(agent);
    const body = {
      nombre: 'ConPermisos',
      apellidos: `Editado ${SUFFIX}`,
      correo: `conpermisos.editado.${lower}@omegavet.test`,
      username: `conpermisos.editado.${lower}`,
      estatus: 'activo',
      permisosSeccion: '1',
      permisos: permisoIds.map(String),
      ...overrides,
    };
    return agent.put(`/usuarios/${id}`).type('form').set('x-csrf-token', csrfToken).send(body);
  }

  beforeAll(async () => {
    await createTestUser(CON_PERMISOS_USER, [
      'usuarios.ver',
      'usuarios.crear',
      'usuarios.editar',
      'usuarios.permisos',
    ]);
  });

  it('AC: el formulario de alta muestra el apartado de Permisos con usuarios.permisos', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);

    const res = await agent.get('/usuarios/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Permisos');
    expect(res.text).toContain('name="permisos"');
    expect(res.text).toContain('name="permisosSeccion"');
  });

  it('AC: sin usuarios.permisos, el formulario NO muestra el apartado ni checkboxes de permisos', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await agent.get('/usuarios/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('name="permisos"');
    expect(res.text).not.toContain('name="permisosSeccion"');
  });

  it('AC: alta con permisos seleccionados crea una fila en usuario_permisos por cada uno, con otorgado_por/otorgado_en', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verId = await permisoId('doctores.ver');
    const crearId = await permisoId('doctores.crear');

    const res = await crearConPermisos(
      agent,
      { username: `matriz.alta.${lower}`, correo: `matriz.alta.${lower}@omegavet.test` },
      [verId, crearId],
    );

    expect(res.status).toBe(200);
    const usuario = await db('usuarios').where('username', `matriz.alta.${lower}`).first();
    const filas = await db('usuario_permisos').where({ usuario_id: usuario.id });

    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.permission_id).sort()).toEqual([verId, crearId].sort());
    filas.forEach((fila) => {
      expect(fila.otorgado_por).not.toBeNull();
      expect(fila.otorgado_en).not.toBeNull();
    });
  });

  it('alta sin ningún permiso marcado no crea ninguna relación', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);

    const res = await crearConPermisos(agent, {
      username: `matriz.sinpermisos.${lower}`,
      correo: `matriz.sinpermisos.${lower}@omegavet.test`,
    });

    expect(res.status).toBe(200);
    const usuario = await db('usuarios').where('username', `matriz.sinpermisos.${lower}`).first();
    const filas = await db('usuario_permisos').where({ usuario_id: usuario.id });
    expect(filas).toHaveLength(0);
  });

  it('AC: el formulario de edición precarga marcados los permisos ya asignados', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verId = await permisoId('areas.ver');
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Precargado',
        apellidos: `Permisos ${SUFFIX}`,
        correo: `precargado.permisos.${lower}@omegavet.test`,
        username: `precargado.permisos.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      })
      .returning('id');
    await db('usuario_permisos').insert({
      usuario_id: usuario.id,
      permission_id: verId,
      otorgado_en: db.fn.now(),
    });

    const res = await agent.get(`/usuarios/${usuario.id}/editar`);

    const inputRegex = new RegExp(
      `<input type="checkbox" name="permisos" value="${verId}"[^>]*checked`,
    );
    expect(res.text).toMatch(inputRegex);
  });

  it('AC: marcar un permiso nuevo en edición crea la relación con otorgado_por/otorgado_en de la sesión', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verId = await permisoId('plantillas.ver');
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Marcar',
        apellidos: `Nuevo ${SUFFIX}`,
        correo: `marcar.nuevo.${lower}@omegavet.test`,
        username: `marcar.nuevo.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      })
      .returning('id');

    const res = await editarConPermisos(
      agent,
      usuario.id,
      { username: `marcar.nuevo.${lower}`, correo: `marcar.nuevo.${lower}@omegavet.test` },
      [verId],
    );

    expect(res.status).toBe(200);
    const fila = await db('usuario_permisos')
      .where({ usuario_id: usuario.id, permission_id: verId })
      .first();
    expect(fila).toBeDefined();
    expect(fila.otorgado_por).not.toBeNull();
    expect(fila.otorgado_en).not.toBeNull();
  });

  it('AC: desmarcar un permiso existente en edición elimina la relación', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verId = await permisoId('plantillas.ver');
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Desmarcar',
        apellidos: `Existente ${SUFFIX}`,
        correo: `desmarcar.existente.${lower}@omegavet.test`,
        username: `desmarcar.existente.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      })
      .returning('id');
    await db('usuario_permisos').insert({
      usuario_id: usuario.id,
      permission_id: verId,
      otorgado_en: db.fn.now(),
    });

    const res = await editarConPermisos(
      agent,
      usuario.id,
      {
        username: `desmarcar.existente.${lower}`,
        correo: `desmarcar.existente.${lower}@omegavet.test`,
      },
      [], // ninguno seleccionado
    );

    expect(res.status).toBe(200);
    const fila = await db('usuario_permisos')
      .where({ usuario_id: usuario.id, permission_id: verId })
      .first();
    expect(fila).toBeUndefined();
  });

  it('AC: un permiso que se queda marcado no se re-inserta ni cambia otorgado_por/otorgado_en', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verId = await permisoId('metricas.agenda.ver');
    const otorganteOriginal = await db('usuarios').where('username', ADMIN_USERNAME).first('id');
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'SigueMarcado',
        apellidos: `SinCambios ${SUFFIX}`,
        correo: `siguemarcado.${lower}@omegavet.test`,
        username: `siguemarcado.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      })
      .returning('id');
    const otorgadoEnOriginal = new Date('2020-01-01T00:00:00Z');
    await db('usuario_permisos').insert({
      usuario_id: usuario.id,
      permission_id: verId,
      otorgado_por: otorganteOriginal.id,
      otorgado_en: otorgadoEnOriginal,
    });

    const res = await editarConPermisos(
      agent,
      usuario.id,
      { username: `siguemarcado.${lower}`, correo: `siguemarcado.${lower}@omegavet.test` },
      [verId], // sigue marcado, sin cambios
    );

    expect(res.status).toBe(200);
    const filas = await db('usuario_permisos').where({
      usuario_id: usuario.id,
      permission_id: verId,
    });
    expect(filas).toHaveLength(1); // no se duplicó
    expect(filas[0].otorgado_por).toBe(otorganteOriginal.id); // no se reescribió al editor actual
    expect(new Date(filas[0].otorgado_en).getTime()).toBe(otorgadoEnOriginal.getTime());
  });

  it('AC: sin usuarios.permisos, enviar el campo directo al servidor se rechaza aunque tenga usuarios.editar', async () => {
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Ataque',
        apellidos: `SinPermisos ${SUFFIX}`,
        correo: `ataque.sinpermisos.${lower}@omegavet.test`,
        username: `ataque.sinpermisos.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      })
      .returning('id');

    const verId = await permisoId('metricas.agenda.ver');
    const agent = await loginAs(SOLO_EDITAR_USER); // tiene usuarios.editar, NO usuarios.permisos
    const csrfToken = await getUsuariosCsrfToken(agent);

    const res = await agent
      .put(`/usuarios/${usuario.id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'Ataque',
        apellidos: `SinPermisos ${SUFFIX}`,
        correo: `ataque.sinpermisos.${lower}@omegavet.test`,
        username: `ataque.sinpermisos.${lower}`,
        estatus: 'activo',
        permisosSeccion: '1',
        permisos: [String(verId)],
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const filas = await db('usuario_permisos').where({ usuario_id: usuario.id });
    expect(filas).toHaveLength(0); // no se coló ninguna relación
  });

  it('AC: sin usuarios.permisos, enviar el campo directo en el alta también se rechaza', async () => {
    const agent = await loginAs(SOLO_CREAR_USER); // tiene usuarios.crear, NO usuarios.permisos
    const csrfToken = await getUsuariosCsrfToken(agent);
    const verId = await permisoId('metricas.agenda.ver');

    const res = await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'Ataque',
        apellidos: `AltaSinPermisos ${SUFFIX}`,
        correo: `ataque.altasinpermisos.${lower}@omegavet.test`,
        username: `ataque.altasinpermisos.${lower}`,
        password: 'ContraseñaSegura1',
        permisosSeccion: '1',
        permisos: [String(verId)],
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const row = await db('usuarios').where('username', `ataque.altasinpermisos.${lower}`).first();
    expect(row).toBeUndefined(); // el request completo se rechazó, no solo los permisos
  });

  it('retirar usuarios.permisos de un usuario cuando hay otro administrador activo (el admin bootstrap) se permite', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const permisoAdminId = await permisoId('usuarios.permisos');
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'RetirarAdmin',
        apellidos: `PermiteOtro ${SUFFIX}`,
        correo: `retiraradmin.${lower}@omegavet.test`,
        username: `retiraradmin.${lower}`,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      })
      .returning('id');
    await db('usuario_permisos').insert({
      usuario_id: usuario.id,
      permission_id: permisoAdminId,
      otorgado_en: db.fn.now(),
    });

    const res = await editarConPermisos(
      agent,
      usuario.id,
      {
        username: `retiraradmin.${lower}`,
        correo: `retiraradmin.${lower}@omegavet.test`,
      },
      [], // retira usuarios.permisos — el admin bootstrap sigue activo con ese permiso
    );

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeUsuarioModal');
    const fila = await db('usuario_permisos')
      .where({ usuario_id: usuario.id, permission_id: permisoAdminId })
      .first();
    expect(fila).toBeUndefined();
  });
});

describe('US-604 (segunda/tercera iteración) — tabs, agenda por categoría, folding y Carga y Envío', () => {
  const lower = SUFFIX.toLowerCase();

  async function permisoId(codigo) {
    const row = await db('permissions').where({ codigo }).first('id');
    return row.id;
  }

  it('AC: el formulario muestra 3 tabs (Menú Principal/Agendas/Configuraciones) y el tab Agendas trae las categorías fijas de agenda', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);

    const res = await agent.get('/usuarios/nuevo');

    expect(res.text).toContain('Menú Principal');
    expect(res.text).toContain('Agendas');
    expect(res.text).toContain('Configuraciones');
    expect(res.text).toContain('Cardiología'); // etiqueta de agenda_cardiologia, no de un módulo estático viejo
  });

  it('AC: el apartado de Usuarios ya NO muestra checkboxes separados de Permisos/Restablecer contraseña', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verId = await permisoId('usuarios.ver');
    const permisosId = await permisoId('usuarios.permisos');
    const resetId = await permisoId('usuarios.resetear_password');

    const res = await agent.get('/usuarios/nuevo');

    expect(res.text).toContain(`value="${verId}"`);
    expect(res.text).not.toContain(`value="${permisosId}"`);
    expect(res.text).not.toContain(`value="${resetId}"`);
  });

  it('AC: marcar el checkbox de una categoría de agenda otorga ese permiso real (agenda.consultas.ver)', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verConsultasId = await permisoId('agenda.consultas.ver');
    const csrfToken = await getUsuariosCsrfToken(agent);
    const username = `agenda.consultas.${lower}`;

    const res = await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'AgendaConsultas',
        apellidos: `AgendaConsultas ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password: 'ContraseñaSegura1',
        permisosSeccion: '1',
        permisos: [String(verConsultasId)],
      });

    expect(res.status).toBe(200);
    const usuario = await db('usuarios').where({ username }).first();
    const fila = await db('usuario_permisos')
      .where({ usuario_id: usuario.id, permission_id: verConsultasId })
      .first();
    expect(fila).toBeDefined();
  });

  it('AC: el checkbox combinado "Carga y Envío" otorga laboratorio.cargar Y laboratorio.enviar juntos', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const cargarId = await permisoId('laboratorio.cargar');
    const enviarId = await permisoId('laboratorio.enviar');
    const csrfToken = await getUsuariosCsrfToken(agent);
    const username = `cargaenvio.${lower}`;

    const res = await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'CargaEnvio',
        apellidos: `CargaEnvio ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password: 'ContraseñaSegura1',
        permisosSeccion: '1',
        permisos: [`${cargarId},${enviarId}`], // un solo checkbox, un solo value combinado
      });

    expect(res.status).toBe(200);
    const usuario = await db('usuarios').where({ username }).first();
    const filas = await db('usuario_permisos')
      .where({ usuario_id: usuario.id })
      .whereIn('permission_id', [cargarId, enviarId]);
    expect(filas).toHaveLength(2);
  });

  it('AC: marcar usuarios.editar otorga automáticamente usuarios.permisos y usuarios.resetear_password (y Ver, por la regla "Ver implica las demás acciones")', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const verId = await permisoId('usuarios.ver');
    const editarId = await permisoId('usuarios.editar');
    const permisosId = await permisoId('usuarios.permisos');
    const resetId = await permisoId('usuarios.resetear_password');
    const csrfToken = await getUsuariosCsrfToken(agent);
    const username = `editarincluye.${lower}`;

    const res = await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'EditarIncluye',
        apellidos: `EditarIncluye ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password: 'ContraseñaSegura1',
        permisosSeccion: '1',
        permisos: [String(editarId)], // solo se marca Editar, no permisos/reset/ver
      });

    expect(res.status).toBe(200);
    const usuario = await db('usuarios').where({ username }).first();
    const filas = await db('usuario_permisos')
      .where({ usuario_id: usuario.id })
      .pluck('permission_id');
    expect(filas.sort()).toEqual([verId, editarId, permisosId, resetId].sort());
  });

  it('AC: desmarcar usuarios.editar en edición retira también usuarios.permisos y usuarios.resetear_password', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const editarId = await permisoId('usuarios.editar');
    const verId = await permisoId('usuarios.ver');
    const permisosId = await permisoId('usuarios.permisos');
    const resetId = await permisoId('usuarios.resetear_password');
    const username = `desmarcareditar.${lower}`;

    // Alta con usuarios.editar marcado (folding ya probado arriba)
    const csrfToken1 = await getUsuariosCsrfToken(agent);
    await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken1)
      .send({
        nombre: 'DesmarcarEditar',
        apellidos: `DesmarcarEditar ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password: 'ContraseñaSegura1',
        permisosSeccion: '1',
        permisos: [String(editarId)],
      });
    const usuario = await db('usuarios').where({ username }).first();
    const antes = await db('usuario_permisos')
      .where({ usuario_id: usuario.id })
      .pluck('permission_id');
    expect(antes.sort()).toEqual([verId, editarId, permisosId, resetId].sort());

    // Edición: se desmarca Editar (solo queda Ver)
    const csrfToken2 = await getUsuariosCsrfToken(agent);
    const res = await agent
      .put(`/usuarios/${usuario.id}`)
      .type('form')
      .set('x-csrf-token', csrfToken2)
      .send({
        nombre: 'DesmarcarEditar',
        apellidos: `DesmarcarEditar ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        estatus: 'activo',
        permisosSeccion: '1',
        permisos: [String(verId)],
      });

    expect(res.status).toBe(200);
    const despues = await db('usuario_permisos')
      .where({ usuario_id: usuario.id })
      .pluck('permission_id');
    expect(despues).toEqual([verId]);
  });
});

describe('US-604 (sexta iteración) — validación de correo y regla "Ver implica las demás acciones"', () => {
  const lower = SUFFIX.toLowerCase();

  async function permisoId(codigo) {
    const row = await db('permissions').where({ codigo }).first('id');
    return row.id;
  }

  async function crearUsuarioRaw(agent, overrides = {}) {
    const csrfToken = await getUsuariosCsrfToken(agent);
    const body = {
      nombre: 'Sexta',
      apellidos: `Iteracion ${SUFFIX}`,
      correo: `sexta.iteracion.${lower}@omegavet.test`,
      username: `sexta.iteracion.${lower}`,
      password: 'ContraseñaSegura1',
      ...overrides,
    };
    return agent.post('/usuarios').type('form').set('x-csrf-token', csrfToken).send(body);
  }

  it('AC: un correo sin formato válido muestra el error y no crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `correoinvalido.${lower}`;

    const res = await crearUsuarioRaw(agent, { username, correo: 'no-es-un-correo' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('El correo no tiene un formato válido.');
    const row = await db('usuarios').where({ username }).first();
    expect(row).toBeUndefined();
  });

  it('AC: la edición también rechaza un correo sin formato válido, sin actualizar el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `correoinvalidoeditar.${lower}`;
    await crearUsuarioRaw(agent, { username, correo: `${username}@omegavet.test` });
    const usuario = await db('usuarios').where({ username }).first();

    const csrfToken = await getUsuariosCsrfToken(agent);
    const res = await agent
      .put(`/usuarios/${usuario.id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'Sexta',
        apellidos: `Iteracion ${SUFFIX}`,
        correo: 'todavia con espacios@omegavet.test',
        username,
        estatus: 'activo',
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('El correo no tiene un formato válido.');
    const sinCambios = await db('usuarios').where({ id: usuario.id }).first();
    expect(sinCambios.correo).toBe(`${username}@omegavet.test`);
  });

  it('AC: enviar directo al servidor una acción sin "Ver" (bypass del JS del cliente) agrega Ver automáticamente', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const crearAreasId = await permisoId('areas.crear');
    const verAreasId = await permisoId('areas.ver');
    const csrfToken = await getUsuariosCsrfToken(agent);
    const username = `versinver.${lower}`;

    const res = await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'VerCascada',
        apellidos: `SinVer ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password: 'ContraseñaSegura1',
        permisosSeccion: '1',
        permisos: [String(crearAreasId)], // sin areas.ver — el JS del cliente ya no interviene aquí
      });

    expect(res.status).toBe(200);
    const usuario = await db('usuarios').where({ username }).first();
    const filas = await db('usuario_permisos')
      .where({ usuario_id: usuario.id })
      .pluck('permission_id');
    expect(filas.sort()).toEqual([crearAreasId, verAreasId].sort());
  });

  it('AC: la regla Ver nunca quita una acción ya marcada — es de una sola dirección (solo agrega Ver)', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const crearAreasId = await permisoId('areas.crear');
    const editarAreasId = await permisoId('areas.editar');
    const verAreasId = await permisoId('areas.ver');
    const csrfToken = await getUsuariosCsrfToken(agent);
    const username = `verunidireccional.${lower}`;

    const res = await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'VerUnidireccional',
        apellidos: `SinVer ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password: 'ContraseñaSegura1',
        permisosSeccion: '1',
        permisos: [String(crearAreasId), String(editarAreasId)],
      });

    expect(res.status).toBe(200);
    const usuario = await db('usuarios').where({ username }).first();
    const filas = await db('usuario_permisos')
      .where({ usuario_id: usuario.id })
      .pluck('permission_id');
    expect(filas.sort()).toEqual([crearAreasId, editarAreasId, verAreasId].sort());
  });

  it('también aplica en edición: agregar una acción sin Ver, la agrega junto con Ver', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);
    const crearAreasId = await permisoId('areas.crear');
    const verAreasId = await permisoId('areas.ver');
    const username = `vereditar.${lower}`;
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'VerEditar',
        apellidos: `SinVer ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      })
      .returning('id');

    const csrfToken = await getUsuariosCsrfToken(agent);
    const res = await agent
      .put(`/usuarios/${usuario.id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'VerEditar',
        apellidos: `SinVer ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        estatus: 'activo',
        permisosSeccion: '1',
        permisos: [String(crearAreasId)],
      });

    expect(res.status).toBe(200);
    const filas = await db('usuario_permisos')
      .where({ usuario_id: usuario.id })
      .pluck('permission_id');
    expect(filas.sort()).toEqual([crearAreasId, verAreasId].sort());
  });
});

describe('POST /usuarios/username-sugerido (US-604, sexta iteración)', () => {
  const lower = SUFFIX.toLowerCase();

  async function sugerirUsernameHttp(agent, body) {
    const csrfToken = await getUsuariosCsrfToken(agent);
    return agent.post('/usuarios/username-sugerido').set('x-csrf-token', csrfToken).send(body);
  }

  it('AC: propone primerNombre.primerApellido, sin acentos ni mayúsculas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await sugerirUsernameHttp(agent, {
      nombre: 'María Fernanda',
      apellidos: 'Muñoz López',
    });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('maria.munoz');
  });

  it('AC: si el prefijo ya existe, propone el siguiente consecutivo tomando el mayor sufijo existente + 1', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const prefijo = `consecutivo.${lower}`;
    await db('usuarios').insert([
      {
        nombre: 'Existente',
        apellidos: `Uno ${SUFFIX}`,
        correo: `${prefijo}.existente1@omegavet.test`,
        username: prefijo,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      },
      {
        nombre: 'Existente',
        apellidos: `Dos ${SUFFIX}`,
        correo: `${prefijo}.existente2@omegavet.test`,
        username: `${prefijo}.3`,
        password_hash: await bcrypt.hash('x', 4),
        creado_en: db.fn.now(),
      },
    ]);

    const res = await sugerirUsernameHttp(agent, { nombre: 'Consecutivo', apellidos: SUFFIX });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe(`${prefijo}.4`);
  });

  it('sin nombre o sin apellidos, devuelve username vacío', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const res = await sugerirUsernameHttp(agent, { nombre: '', apellidos: '' });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('');
  });

  it('sin usuarios.crear se rechaza (mismo permiso que abre el formulario de alta)', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER); // usuarios.editar, sin usuarios.crear
    const csrfToken = await getUsuariosCsrfToken(agent);

    const res = await agent
      .post('/usuarios/username-sugerido')
      .set('x-csrf-token', csrfToken)
      .send({ nombre: 'Ana', apellidos: 'Gómez' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const res = await agent
      .post('/usuarios/username-sugerido')
      .send({ nombre: 'Ana', apellidos: 'Gómez' });
    expect(res.status).toBe(403);
  });
});

describe('AC: conflicto de username al guardar recalcula el consecutivo y avisa (US-604, sexta iteración)', () => {
  const lower = SUFFIX.toLowerCase();

  it('crear con un username ya tomado re-renderiza el formulario con el nuevo consecutivo precargado, sin guardar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const username = `conflicto.${lower}`;
    await db('usuarios').insert({
      nombre: 'Original',
      apellidos: `Conflicto ${SUFFIX}`,
      correo: `${username}.original@omegavet.test`,
      username,
      password_hash: await bcrypt.hash('x', 4),
      creado_en: db.fn.now(),
    });

    const csrfToken = await getUsuariosCsrfToken(agent);
    const res = await agent
      .post('/usuarios')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: 'Intento',
        apellidos: `Conflicto ${SUFFIX}`,
        correo: `${username}.intento@omegavet.test`,
        username,
        password: 'ContraseñaSegura1',
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Se ha actualizado a &#34;${username}.2&#34;`);
    expect(res.text).toContain(`value="${username}.2"`);

    const original = await db('usuarios').where({ username }).first();
    expect(original).toBeDefined(); // el registro original sigue intacto
    const propuesto = await db('usuarios')
      .where({ username: `${username}.2` })
      .first();
    expect(propuesto).toBeUndefined(); // el consecutivo es solo una PROPUESTA, no se guarda solo
  });
});

describe('DELETE /usuarios/:id (US-603 — baja)', () => {
  const lower = SUFFIX.toLowerCase();

  beforeAll(async () => {
    await createTestUser(SOLO_ELIMINAR_USER, ['usuarios.ver', 'usuarios.eliminar']);
  });

  async function crearUsuarioObjetivo(slug, { password = 'x', ...overrides } = {}) {
    const username = `baja.${slug}.${lower}`;
    const [usuario] = await db('usuarios')
      .insert({
        nombre: 'Baja',
        apellidos: `${slug} ${SUFFIX}`,
        correo: `${username}@omegavet.test`,
        username,
        password_hash: await bcrypt.hash(password, 4),
        estatus: 'activo',
        creado_en: db.fn.now(),
        ...overrides,
      })
      .returning('*');
    return usuario;
  }

  it('AC: confirmar la baja establece estatus=inactivo, desactivado_por/desactivado_en, y el usuario deja de ofrecer la acción', async () => {
    const objetivo = await crearUsuarioObjetivo('exitosa');
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getUsuariosCsrfToken(agent);

    const res = await agent
      .delete(`/usuarios/${objetivo.id}?estatus=todos&q=${objetivo.username}`)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Inactivo');
    expect(res.text).not.toContain(`hx-delete="usuarios/${objetivo.id}"`);

    const actualizado = await db('usuarios').where({ id: objetivo.id }).first();
    expect(actualizado.estatus).toBe('inactivo');
    expect(actualizado.desactivado_por).not.toBeNull();
    expect(actualizado.desactivado_en).not.toBeNull();
  });

  it('AC: rechaza dar de baja la propia cuenta, sin modificar el registro', async () => {
    const agent = await loginAs(SOLO_ELIMINAR_USER);
    const propio = await db('usuarios').where({ username: SOLO_ELIMINAR_USER.username }).first();
    const csrfToken = await getUsuariosCsrfToken(agent);

    const res = await agent.delete(`/usuarios/${propio.id}`).set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Un usuario no puede dar de baja su propia cuenta.');

    const sinCambios = await db('usuarios').where({ id: propio.id }).first();
    expect(sinCambios.estatus).toBe('activo');
    expect(sinCambios.desactivado_por).toBeNull();
  });

  it('AC: reprocesar la baja de un usuario ya inactivo no modifica desactivado_por/desactivado_en existentes', async () => {
    const otroAdmin = await db('usuarios').where('username', ADMIN_USERNAME).first('id');
    const fechaOriginal = new Date('2020-01-01T00:00:00Z');
    const objetivo = await crearUsuarioObjetivo('yainactivo', {
      estatus: 'inactivo',
      desactivado_por: otroAdmin.id,
      desactivado_en: fechaOriginal,
    });

    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getUsuariosCsrfToken(agent);
    const res = await agent.delete(`/usuarios/${objetivo.id}`).set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    const sinCambios = await db('usuarios').where({ id: objetivo.id }).first();
    expect(sinCambios.estatus).toBe('inactivo');
    expect(sinCambios.desactivado_por).toBe(otroAdmin.id);
    expect(new Date(sinCambios.desactivado_en).getTime()).toBe(fechaOriginal.getTime());
  });

  it('sin usuarios.eliminar se rechaza, sin modificar el registro', async () => {
    const objetivo = await crearUsuarioObjetivo('sinpermiso');
    const agent = await loginAs(SOLO_EDITAR_USER); // usuarios.editar, sin usuarios.eliminar
    const csrfToken = await getUsuariosCsrfToken(agent);

    const res = await agent.delete(`/usuarios/${objetivo.id}`).set('x-csrf-token', csrfToken);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const sinCambios = await db('usuarios').where({ id: objetivo.id }).first();
    expect(sinCambios.estatus).toBe('activo');
  });

  it('sin token CSRF es rechazado', async () => {
    const objetivo = await crearUsuarioObjetivo('sincsrf');
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.delete(`/usuarios/${objetivo.id}`);

    expect(res.status).toBe(403);
  });

  it('AC: dar de baja invalida cualquier sesión activa del usuario — su siguiente request a una ruta protegida lo redirige al login', async () => {
    const password = 'ObjetivoSesion123!';
    const objetivo = await crearUsuarioObjetivo('sesionactiva', { password });
    const { agent: agenteObjetivo, sid } = await loginAsConSid({
      username: objetivo.username,
      password,
    });

    const antesDeBaja = await agenteObjetivo.get('/main.html');
    expect(antesDeBaja.status).toBe(200);
    const sessionRowAntes = await db('session').where({ sid }).first();
    expect(sessionRowAntes).toBeDefined();

    const adminAgent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getUsuariosCsrfToken(adminAgent);
    await adminAgent.delete(`/usuarios/${objetivo.id}`).set('x-csrf-token', csrfToken);

    const sessionRowDespues = await db('session').where({ sid }).first();
    expect(sessionRowDespues).toBeUndefined();

    const despuesDeBaja = await agenteObjetivo.get('/main.html');
    expect(despuesDeBaja.status).toBe(302);
    expect(despuesDeBaja.headers.location).toBe('/');
  });
});
