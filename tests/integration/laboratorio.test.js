// Laboratorio: catálogo completo + backend real. Requiere una base de datos
// real migrada y sembrada (ver auth.test.js para el porqué).
//
// A propósito, este archivo NUNCA inserta en `doctores` — regla ya
// establecida en el proyecto (ver el comentario en doctores.test.js/
// agenda.test.js: doctores.test.js tiene un test que asume esa tabla
// COMPLETAMENTE VACÍA, y Jest corre los archivos de test en paralelo). La
// cobertura de un alta real con un doctor de verdad queda en
// laboratorio.service.test.js (repository mockeado) y en la verificación en
// vivo (Playwright, usuario QA desechable) — no aquí.
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SUFFIX = 'QALABORATORIO';

const SOLO_VER = { username: 'laboratorio.ver.test', password: 'LaboratorioVerTest123!' };
const SOLO_CREAR = { username: 'laboratorio.crear.test', password: 'LaboratorioCrearTest123!' };
const SOLO_ELIMINAR = {
  username: 'laboratorio.eliminar.test',
  password: 'LaboratorioEliminarTest123!',
};
const SIN_PERMISOS = {
  username: 'laboratorio.sinpermiso.test',
  password: 'LaboratorioSinPermisoTest123!',
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

// A diferencia de doctores.test.js (el catálogo de doctores nunca está
// vacío en la BD de pruebas), `registros_laboratorio` sí puede estarlo —
// nada más lo puebla. El token del toolbar (#laboratorio-filters) solo
// existe cuando catalogoVacio es false, así que se usa este otro, siempre
// presente sin importar el estado (ver laboratorio.ejs#laboratorioPageCsrfToken).
async function getLaboratorioCsrfToken(agent) {
  const res = await agent.get('/laboratorio.html');
  const match = res.text.match(/id="laboratorioPageCsrfToken" value="([^"]+)"/);
  return match[1];
}

async function cleanup() {
  const usernames = [
    SOLO_VER.username,
    SOLO_CREAR.username,
    SOLO_ELIMINAR.username,
    SIN_PERMISOS.username,
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
      apellidos: SUFFIX,
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
  await createTestUser(SOLO_VER, ['laboratorio.ver']);
  await createTestUser(SOLO_CREAR, ['laboratorio.ver', 'laboratorio.crear']);
  await createTestUser(SOLO_ELIMINAR, ['laboratorio.ver', 'laboratorio.eliminar']);
  await createTestUser(SIN_PERMISOS, []);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /laboratorio.html', () => {
  it('AC: con laboratorio.ver, abre la página con el toolbar/tabla', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/laboratorio.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="laboratorio-panel"');
  });

  it('un usuario sin laboratorio.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/laboratorio.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('solo con laboratorio.ver (sin crear/eliminar) no muestra el botón "Nuevo registro"', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio.html');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('btnNuevoRegistro');
  });
});

describe('GET /laboratorio/nuevo', () => {
  it('AC: con laboratorio.crear, trae el catálogo completo embebido (33 categorías)', async () => {
    const agent = await loginAs(SOLO_CREAR);

    const res = await agent.get('/laboratorio/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).toContain('labFormData');
    const match = res.text.match(/<div id="labFormData" hidden>(.*?)<\/div>/s);
    const datos = JSON.parse(match[1].replace(/\\u003c/g, '<'));
    expect(datos.catalogo.categorias).toHaveLength(33);
    expect(datos.catalogo.componentesLiquido.length).toBeGreaterThan(0);
    expect(datos.catalogo.zonasAnatomicas.length).toBeGreaterThan(0);
  });

  it('un usuario sin laboratorio.crear es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio/nuevo');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /laboratorio.html (filtro)', () => {
  // El catálogo de `registros_laboratorio` en la BD de pruebas no se siembra
  // (es dato generado por la app, no fixture) — puede estar vacío o no según
  // qué otros tests hayan corrido antes en paralelo, así que la aserción no
  // puede depender de un texto específico de una de las 2 ramas
  // (catalogoVacio vs. "sin resultados"); solo que el filtro no truena.
  it('AC: con laboratorio.ver, una búsqueda sin resultados no truena (200, nunca 500)', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio.html').set('x-csrf-token', csrfToken).send({
      q: 'esta-busqueda-no-deberia-existir-nunca-jamas',
      estado: '',
      categoriaId: '',
      page: 1,
    });

    expect(res.status).toBe(200);
  });
});

describe('POST /laboratorio/buscar-tutor', () => {
  // Pedido explícito del usuario: "Nuevo registro" arranca de un tutor YA
  // REGISTRADO por su teléfono — un teléfono que no existe responde
  // {existe:false}, nunca un arreglo/lista como el viejo buscar-mascota.
  it('AC: con laboratorio.crear, un teléfono que no existe responde {existe:false}', async () => {
    const agent = await loginAs(SOLO_CREAR);
    const formulario = await agent.get('/laboratorio/nuevo');
    const match = formulario.text.match(/<div id="labFormData" hidden>(.*?)<\/div>/s);
    const { csrfToken } = JSON.parse(match[1].replace(/\\u003c/g, '<'));

    const res = await agent
      .post('/laboratorio/buscar-tutor')
      .set('x-csrf-token', csrfToken)
      .send({ telefono: '0000000000' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ existe: false });
  });

  it('un usuario sin laboratorio.crear es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.post('/laboratorio/buscar-tutor').send({ telefono: '0000000000' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /laboratorio', () => {
  it('AC: un alta inválida (sin mascotaId) responde 400 con el mensaje de negocio, no un 500', async () => {
    const agent = await loginAs(SOLO_CREAR);
    const formulario = await agent.get('/laboratorio/nuevo');
    const match = formulario.text.match(/<div id="labFormData" hidden>(.*?)<\/div>/s);
    const { csrfToken } = JSON.parse(match[1].replace(/\\u003c/g, '<'));

    const res = await agent
      .post('/laboratorio')
      .set('x-csrf-token', csrfToken)
      .send({ doctorId: 1, fechaSolicitud: '2026-08-27', estudios: [{ estudioId: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Selecciona un paciente.');
  });

  it('un usuario sin laboratorio.crear es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.post('/laboratorio').send({});

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

// Pedido explícito del usuario: alta/edición/consulta son cada una su
// propia pantalla completa (mismo patrón que /tutores/nuevo,
// /tutores/:id/editar) — GET /laboratorio/:id/editar sirve tanto edición
// como consulta (soloLectura decidido por el permiso, no una ruta aparte).
describe('GET /laboratorio/:id/editar', () => {
  it('AC: laboratorio.ver alcanza para abrir la pantalla (consulta si no tiene laboratorio.editar)', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio/999999/editar');

    // Un id inexistente es 404 real (no un no-op silencioso como eliminar) —
    // igual confirma que el permiso de SOLO ver ya pasó el middleware de la
    // ruta y llegó al controller.
    expect(res.status).toBe(404);
  });

  it('un usuario sin laboratorio.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/laboratorio/999999/editar');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

// Ícono de "ojo" nuevo en la tabla (pedido explícito del usuario): misma
// pantalla y mismo permiso mínimo que /editar, pero el controller siempre
// fuerza soloLectura=true — la cobertura de que el picker/Guardar
// desaparecen de verdad en ese modo ya la tiene laboratorio_pantalla_completa
// (verificación en vivo); aquí solo se cubre el permiso, mismo criterio que
// el describe de /editar de arriba.
describe('GET /laboratorio/:id/ver', () => {
  it('AC: laboratorio.ver alcanza para abrir la pantalla', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio/999999/ver');

    expect(res.status).toBe(404);
  });

  it('un usuario sin laboratorio.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/laboratorio/999999/ver');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('PUT /laboratorio/:id', () => {
  it('un usuario sin laboratorio.editar es rebotado a /main.html (aunque tenga laboratorio.crear)', async () => {
    const agent = await loginAs(SOLO_CREAR);

    const res = await agent.put('/laboratorio/999999').send({});

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('DELETE /laboratorio/:id', () => {
  it('un usuario sin laboratorio.eliminar es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_CREAR);

    const res = await agent.delete('/laboratorio/999999');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('AC: con laboratorio.eliminar, un id inexistente no truena (idempotente) y regresa el panel', async () => {
    const agent = await loginAs(SOLO_ELIMINAR);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.delete('/laboratorio/999999').set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
  });
});
