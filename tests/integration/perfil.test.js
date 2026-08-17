// US-109: Mi perfil — consultar/actualizar los propios datos personales.
// Requiere una base de datos real (ver auth.test.js).
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const SIN_PERMISOS_USER = { username: 'sin.permisos.us109.test', password: 'SinPermisosTest123!' };
const OTRO_USER = { username: 'otro.us109.test', password: 'OtroUsuarioTest123!' };
const CON_PERMISOS_USER = { username: 'con.permisos.us109.test', password: 'ConPermisosTest123!' };
const CAMBIAR_PWD_USER = {
  username: 'cambiar.pwd.us110.test',
  password: 'MiContraseñaActualUS110Larga1',
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

async function getPerfilCsrfToken(agent) {
  const res = await agent.get('/mi-perfil.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

async function actualizarPerfil(agent, body) {
  const csrfToken = await getPerfilCsrfToken(agent);
  return agent.post('/mi-perfil.html').type('form').set('x-csrf-token', csrfToken).send(body);
}

async function cleanup() {
  const usernames = [
    SIN_PERMISOS_USER.username,
    OTRO_USER.username,
    CON_PERMISOS_USER.username,
    CAMBIAR_PWD_USER.username,
  ];
  const ids = await db('usuarios').whereIn('username', usernames).pluck('id');
  if (ids.length) {
    await db('usuario_permisos').whereIn('usuario_id', ids).del();
    await db('usuarios').whereIn('id', ids).del();
  }
}

// El token CSRF es por sesión, no por formulario (doubleCsrfProtection lo
// valida contra la cookie de sesión, ver config/csrf.js) — el mismo valor
// que embebe el formulario de datos personales sirve para cualquier otra
// ruta protegida de la misma sesión, incluyendo /mi-perfil/password.
async function cambiarPassword(agent, body) {
  const csrfToken = await getPerfilCsrfToken(agent);
  return agent.post('/mi-perfil/password').type('form').set('x-csrf-token', csrfToken).send(body);
}

beforeAll(async () => {
  await cleanup();
  await db('usuarios').insert([
    {
      nombre: 'Sin',
      apellidos: 'Permisos US109',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
      telefono: '55-1111-1111',
      username: SIN_PERMISOS_USER.username,
      password_hash: await bcrypt.hash(SIN_PERMISOS_USER.password, 4),
      creado_en: db.fn.now(),
    },
    {
      nombre: 'Otro',
      apellidos: 'Usuario US109',
      correo: `${OTRO_USER.username}@omegavet.test`,
      username: OTRO_USER.username,
      password_hash: await bcrypt.hash(OTRO_USER.password, 4),
      creado_en: db.fn.now(),
    },
    {
      nombre: 'Con',
      apellidos: 'Permisos US109',
      correo: `${CON_PERMISOS_USER.username}@omegavet.test`,
      username: CON_PERMISOS_USER.username,
      password_hash: await bcrypt.hash(CON_PERMISOS_USER.password, 4),
      creado_en: db.fn.now(),
    },
    {
      nombre: 'Cambiar',
      apellidos: 'Password US110',
      correo: `${CAMBIAR_PWD_USER.username}@omegavet.test`,
      username: CAMBIAR_PWD_USER.username,
      password_hash: await bcrypt.hash(CAMBIAR_PWD_USER.password, 4),
      creado_en: db.fn.now(),
    },
  ]);

  // Datos ligados a la cuenta: NO se inserta en `doctores`/`doctor_area` a
  // propósito — esas tablas ya tienen "dueño único" entre archivos de test
  // (doctores.test.js asume que `doctores` puede estar vacía durante su
  // propio caso de catálogo vacío, ver memoria us601_usuarios_listado.md).
  // El caso "con doctor vinculado + especialidades" se verifica en vivo con
  // Playwright en su lugar; aquí solo se cubre el listado de permisos
  // (usuario_permisos no tiene ese conflicto, cada archivo de test limpia
  // solo sus propios usuarios).
  const permisos = await db('permissions')
    .whereIn('codigo', ['doctores.ver', 'doctores.editar', 'areas.ver'])
    .select('id');
  const { id: conPermisosId } = await db('usuarios')
    .where({ username: CON_PERMISOS_USER.username })
    .first('id');
  await db('usuario_permisos').insert(
    permisos.map((p) => ({
      usuario_id: conPermisosId,
      permission_id: p.id,
      otorgado_en: db.fn.now(),
    })),
  );
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /mi-perfil.html (US-109)', () => {
  it('AC: muestra Nombre/Apellidos/Teléfono/Correo del propio usuario, editables', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/mi-perfil.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('value="Sin"');
    expect(res.text).toContain('value="Permisos US109"');
    expect(res.text).toContain('value="55-1111-1111"');
    expect(res.text).toContain(`value="${SIN_PERMISOS_USER.username}@omegavet.test"`);
  });

  it('AC: no requiere NINGÚN permiso — un usuario sin ningún permiso igual puede entrar', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/mi-perfil.html');

    expect(res.status).toBe(200);
  });

  it('AC: el Username se muestra en "Mi cuenta" como texto plano, nunca como campo de formulario', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/mi-perfil.html');

    expect(res.text).toContain(
      `<div class="profile-summary-value">${SIN_PERMISOS_USER.username}</div>`,
    );
    expect(res.text).not.toContain(`value="${SIN_PERMISOS_USER.username}"`);
    expect(res.text).not.toMatch(/<input[^>]*name="username"/);
  });

  it('sin sesión redirige a /', async () => {
    const res = await request(app).get('/mi-perfil.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('GET /mi-perfil.html — datos ligados a la cuenta (extensión US-109)', () => {
  it('AC: sin doctor vinculado, "Mi cuenta" muestra "Sin vínculo" y "Áreas asignadas" el estado vacío', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/mi-perfil.html');

    expect(res.text).toContain('Sin vínculo');
    expect(res.text).toContain('Esta cuenta no tiene un doctor vinculado.');
  });

  it('AC: sin permisos otorgados, la matriz se muestra completa pero sin ningún check', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/mi-perfil.html');

    expect(res.text).toContain('class="permisos-matrix"');
    expect(res.text).not.toContain('class="permiso-check"');
  });

  it('AC: con permisos otorgados, la matriz de solo lectura marca con check los módulos/acciones otorgados', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);

    const res = await agent.get('/mi-perfil.html');

    expect(res.text).toContain('Catálogo de doctores');
    expect(res.text).toContain('Catálogo de áreas');
    expect(res.text).not.toContain('Esta cuenta no tiene permisos asignados.');
    // 3 permisos otorgados (doctores.ver/doctores.editar/areas.ver) → 3 checks.
    expect((res.text.match(/class="permiso-check"/g) ?? []).length).toBe(3);
  });

  it('el "Datos de mi cuenta" se conserva tras guardar y tras un error de validación', async () => {
    const agent = await loginAs(CON_PERMISOS_USER);

    const okRes = await actualizarPerfil(agent, {
      nombre: 'Con',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${CON_PERMISOS_USER.username}@omegavet.test`,
    });
    expect(okRes.text).toContain('Catálogo de doctores');

    const errorRes = await actualizarPerfil(agent, {
      nombre: '',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${CON_PERMISOS_USER.username}@omegavet.test`,
    });
    expect(errorRes.text).toContain('Catálogo de doctores');
  });
});

describe('POST /mi-perfil.html (US-109)', () => {
  it('AC: actualiza nombre/apellidos/telefono/correo y muestra el mensaje de éxito', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await actualizarPerfil(agent, {
      nombre: 'Sin (editado)',
      apellidos: 'Permisos US109 (editado)',
      telefono: '81-9876-5432',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Perfil actualizado correctamente.');

    const row = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(row.nombre).toBe('Sin (editado)');
    expect(row.apellidos).toBe('Permisos US109 (editado)');
    expect(row.telefono).toBe('81-9876-5432');
  });

  it('AC: registra actualizado_por con el ID DEL PROPIO usuario y actualizado_en', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);
    const antes = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();

    await actualizarPerfil(agent, {
      nombre: 'Sin',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
    });

    const row = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(row.actualizado_por).toBe(antes.id);
    expect(row.actualizado_en).not.toBeNull();
  });

  it('AC: el teléfono es opcional — vacío se guarda como NULL', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    await actualizarPerfil(agent, {
      nombre: 'Sin',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
    });

    const row = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(row.telefono).toBeNull();
  });

  it('AC: rechaza un teléfono con formato inválido, sin modificar el registro', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);
    const antes = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();

    const res = await actualizarPerfil(agent, {
      nombre: 'Sin',
      apellidos: 'Permisos US109',
      telefono: '5512345678',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('El teléfono debe tener el formato NN-NNNN-NNNN.');
    const despues = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(despues.telefono).toBe(antes.telefono);
  });

  it('AC: campos vacíos (Nombre/Apellidos/Correo) se rechazan con un mensaje entendible, sin modificar el registro', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);
    const antes = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();

    const res = await actualizarPerfil(agent, {
      nombre: '',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('El campo Nombre es obligatorio.');
    const despues = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(despues.nombre).toBe(antes.nombre);
  });

  it('rechaza un correo ya usado por otro usuario, sin modificar el registro', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);
    const antes = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();

    const res = await actualizarPerfil(agent, {
      nombre: 'Sin',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${OTRO_USER.username}@omegavet.test`,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('El correo ya está registrado.');
    const despues = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(despues.correo).toBe(antes.correo);
  });

  it('AC: no actualiza username aunque se intente enviar en el body (campo ignorado)', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    await actualizarPerfil(agent, {
      nombre: 'Sin',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
      username: 'username.forjado.us109',
    });

    const row = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(row).toBeDefined();
    const forjado = await db('usuarios').where({ username: 'username.forjado.us109' }).first();
    expect(forjado).toBeUndefined();
  });

  it('AC: identifica al usuario SOLO por la sesión — un id forjado en el body no cambia el objetivo ni afecta a otro usuario', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);
    const otroAntes = await db('usuarios').where({ username: OTRO_USER.username }).first();

    await actualizarPerfil(agent, {
      id: otroAntes.id,
      nombre: 'Intento de modificar a otro',
      apellidos: 'Permisos US109',
      telefono: '',
      correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
    });

    const otroDespues = await db('usuarios').where({ username: OTRO_USER.username }).first();
    expect(otroDespues.nombre).toBe(otroAntes.nombre);

    const propio = await db('usuarios').where({ username: SIN_PERMISOS_USER.username }).first();
    expect(propio.nombre).toBe('Intento de modificar a otro');
  });

  it('sin sesión, el POST también se rechaza', async () => {
    const res = await request(app)
      .post('/mi-perfil.html')
      .type('form')
      .send({ nombre: 'x', apellidos: 'y', correo: 'x@y.com' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('POST /mi-perfil/password (US-110)', () => {
  // Cada test parte del mismo password_hash conocido — evita que el orden
  // de ejecución importe (un test anterior que cambió la contraseña con
  // éxito no debe afectar a los siguientes).
  beforeEach(async () => {
    await db('usuarios')
      .where({ username: CAMBIAR_PWD_USER.username })
      .update({ password_hash: await bcrypt.hash(CAMBIAR_PWD_USER.password, 4) });
  });

  it('AC: la sección "Cambiar contraseña" muestra los 3 campos', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);
    const res = await agent.get('/mi-perfil.html');

    expect(res.text).toContain('name="passwordActual"');
    expect(res.text).toContain('name="passwordNueva"');
    expect(res.text).toContain('name="confirmarPassword"');
  });

  it('AC: rechaza si algún campo está vacío', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);

    const res = await cambiarPassword(agent, {
      passwordActual: '',
      passwordNueva: 'NuevaContraseñaLarga1234',
      confirmarPassword: 'NuevaContraseñaLarga1234',
    });

    expect(res.text).toContain('obligatorios');
  });

  it('AC: rechaza si la contraseña actual es incorrecta, sin modificar el hash guardado', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);
    const antes = await db('usuarios').where({ username: CAMBIAR_PWD_USER.username }).first();

    const res = await cambiarPassword(agent, {
      passwordActual: 'ContraseñaIncorrectaLarga123',
      passwordNueva: 'NuevaContraseñaLarga1234',
      confirmarPassword: 'NuevaContraseñaLarga1234',
    });

    expect(res.text).toContain('La contraseña actual es incorrecta.');
    const despues = await db('usuarios').where({ username: CAMBIAR_PWD_USER.username }).first();
    expect(despues.password_hash).toBe(antes.password_hash);
  });

  it('AC: rechaza si la nueva contraseña y su confirmación no coinciden', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);

    const res = await cambiarPassword(agent, {
      passwordActual: CAMBIAR_PWD_USER.password,
      passwordNueva: 'NuevaContraseñaLarga1234',
      confirmarPassword: 'OtraContraseñaLarga12345',
    });

    expect(res.text).toContain('no coinciden');
  });

  it('AC (Decisión 24): rechaza una nueva contraseña de menos de 15 caracteres', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);

    const res = await cambiarPassword(agent, {
      passwordActual: CAMBIAR_PWD_USER.password,
      passwordNueva: 'Corta1234567',
      confirmarPassword: 'Corta1234567',
    });

    expect(res.text).toContain('al menos 15 caracteres');
  });

  it('AC: rechaza si la nueva contraseña es igual a la actual', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);

    const res = await cambiarPassword(agent, {
      passwordActual: CAMBIAR_PWD_USER.password,
      passwordNueva: CAMBIAR_PWD_USER.password,
      confirmarPassword: CAMBIAR_PWD_USER.password,
    });

    expect(res.text).toContain('diferente a la contraseña actual');
  });

  it('AC: contraseña actual correcta + nueva válida + confirmación coincide -> actualiza el hash, registra auditoría y muestra éxito', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);
    const antes = await db('usuarios').where({ username: CAMBIAR_PWD_USER.username }).first();
    const nuevaPassword = 'MiNuevaContraseñaLargaUS110X';

    const res = await cambiarPassword(agent, {
      passwordActual: CAMBIAR_PWD_USER.password,
      passwordNueva: nuevaPassword,
      confirmarPassword: nuevaPassword,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Contraseña actualizada correctamente.');

    const despues = await db('usuarios').where({ username: CAMBIAR_PWD_USER.username }).first();
    expect(despues.password_hash).not.toBe(antes.password_hash);
    expect(await bcrypt.compare(nuevaPassword, despues.password_hash)).toBe(true);
    expect(despues.actualizado_por).toBe(antes.id);
    expect(despues.actualizado_en).not.toBeNull();
  });

  it('AC: la sesión permanece activa tras un cambio exitoso, sin tener que volver a iniciar sesión', async () => {
    const agent = await loginAs(CAMBIAR_PWD_USER);
    const nuevaPassword = 'OtraNuevaContraseñaLargaUS110';

    await cambiarPassword(agent, {
      passwordActual: CAMBIAR_PWD_USER.password,
      passwordNueva: nuevaPassword,
      confirmarPassword: nuevaPassword,
    });

    const res = await agent.get('/mi-perfil.html');
    expect(res.status).toBe(200);
  });

  it('sin sesión, el POST también se rechaza', async () => {
    const res = await request(app)
      .post('/mi-perfil/password')
      .type('form')
      .send({ passwordActual: 'x', passwordNueva: 'y', confirmarPassword: 'y' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});
