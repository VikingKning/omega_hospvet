// Agenda: calendario real por área — sobre el área sembrada `cirugias`
// (06_areas_agenda.js), con sus 5 permisos granulares ya en el catálogo
// (01_permissions.js). Requiere una base de datos real migrada y sembrada
// (ver tests/integration/auth.test.js para el porqué).
//
// A propósito, este archivo NUNCA inserta en `doctores` — regla ya
// establecida en el proyecto (ver el comentario en doctores.test.js y la
// memoria de US-601): `doctores.test.js` tiene un test que asume esa tabla
// COMPLETAMENTE VACÍA, y Jest corre los archivos de test en paralelo. Todo
// lo que dependería de una cita real completa (doctor válido + traslape +
// edición + feed con datos) se cubre a nivel unitario en
// agenda.service.test.js (repository mockeado) y se verificó en vivo
// (Playwright, usuario QA desechable) en su lugar — no aquí.
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SUFFIX = 'QAAGENDA';

const SOLO_VER = { username: 'agenda.ver.test', password: 'AgendaVerTest123!' };
const SOLO_CREAR = { username: 'agenda.crear.test', password: 'AgendaCrearTest123!' };
const SOLO_EDITAR = { username: 'agenda.editar.test', password: 'AgendaEditarTest123!' };
const SOLO_CANCELAR = { username: 'agenda.cancelar.test', password: 'AgendaCancelarTest123!' };
const SIN_PERMISOS = { username: 'agenda.sinpermiso.test', password: 'AgendaSinPermisoTest123!' };

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

// GET .../agenda/:slug.html no es un fragmento HTMX (es la página completa)
// — a diferencia de areas.html/plantillas.html, el token CSRF de esta
// página no vive en un atributo hx-headers de un <form> (el form real solo
// existe DENTRO del modal, cargado después por HTMX) sino en la constante
// `csrfToken` del <script> de la página, que el JS del cliente reutiliza
// para el fetch() del combobox de mascota.
async function getAgendaCsrfToken(agent, slug) {
  const res = await agent.get(`/agenda/${slug}.html`);
  const match = res.text.match(/const csrfToken = "([^"]+)"/);
  return match[1];
}

async function cleanup() {
  const usernames = [
    SOLO_VER.username,
    SOLO_CREAR.username,
    SOLO_EDITAR.username,
    SOLO_CANCELAR.username,
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

function fechaFutura(horasDesdeAhora = 24 * 30) {
  return new Date(Date.now() + horasDesdeAhora * 60 * 60000).toISOString();
}

beforeAll(async () => {
  await cleanup();
  await createTestUser(SOLO_VER, ['agenda.cirugias.ver']);
  await createTestUser(SOLO_CREAR, ['agenda.cirugias.ver', 'agenda.cirugias.crear']);
  await createTestUser(SOLO_EDITAR, ['agenda.cirugias.ver', 'agenda.cirugias.editar']);
  await createTestUser(SOLO_CANCELAR, ['agenda.cirugias.ver', 'agenda.cirugias.cancelar']);
  await createTestUser(SIN_PERMISOS, []);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /agenda/:slug.html', () => {
  it('AC: con el permiso agenda.<slug>.ver, abre la página con el resumen del día y el calendario', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/agenda/cirugias.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="calendar"');
    expect(res.text).toContain('statProgramadas');
  });

  it('un usuario sin agenda.cirugias.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/agenda/cirugias.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('el permiso es por área: agenda.cirugias.ver no da acceso a /agenda/consultas.html', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/agenda/consultas.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  // Un slug puramente inventado nunca llega a attachArea: como el permiso
  // agenda.<slug>.ver nunca fue sembrado para ese slug, requirePermission
  // ya rebota con 302 antes de resolver el área. El caso real que attachArea
  // sí protege es un área que EXISTE pero está inactiva — su permiso sigue
  // en el catálogo (nunca se borra al desactivar), así que hace falta un
  // fixture propio y aislado (área + permiso temporales, sin tocar
  // `doctores`).
  it('un área desactivada responde 404 aunque el permiso siga otorgado (huérfano)', async () => {
    const slugInactiva = `area-inactiva-${SUFFIX.toLowerCase()}`;
    const [areaInactiva] = await db('areas')
      .insert({
        nombre: `Area Inactiva ${SUFFIX}`,
        slug: slugInactiva,
        activo: false,
        creado_en: db.fn.now(),
      })
      .returning('id');
    const [permiso] = await db('permissions')
      .insert({
        modulo: `agenda_${slugInactiva}`,
        accion: 'ver',
        codigo: `agenda.${slugInactiva}.ver`,
        descripcion: 'test',
      })
      .returning('id');
    const admin = await db('usuarios').where({ username: ADMIN_USERNAME }).first('id');
    await db('usuario_permisos').insert({
      usuario_id: admin.id,
      permission_id: permiso.id,
      otorgado_en: db.fn.now(),
    });

    try {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
      const res = await agent.get(`/agenda/${slugInactiva}.html`);
      expect(res.status).toBe(404);
    } finally {
      await db('usuario_permisos').where({ permission_id: permiso.id }).del();
      await db('permissions').where({ id: permiso.id }).del();
      await db('areas').where({ id: areaInactiva.id }).del();
    }
  });
});

describe('GET /agenda/:slug/citas/nueva (permiso .crear)', () => {
  it('un usuario con agenda.cirugias.crear puede abrir el formulario de alta (catálogo de doctores puede venir vacío, no truena)', async () => {
    const agent = await loginAs(SOLO_CREAR);

    const res = await agent.get('/agenda/cirugias/citas/nueva');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nueva cita');
  });

  it('un usuario con SOLO agenda.cirugias.ver no puede abrir el formulario de alta', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/agenda/cirugias/citas/nueva');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('GET /agenda/:slug/citas/:id/editar (permiso .editar)', () => {
  it('una cita inexistente responde 404 (sin necesidad de una cita real para probar el permiso)', async () => {
    const agent = await loginAs(SOLO_EDITAR);

    const res = await agent.get('/agenda/cirugias/citas/999999999/editar');

    expect(res.status).toBe(404);
  });

  it('un usuario con SOLO agenda.cirugias.ver no puede abrir el formulario de edición', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/agenda/cirugias/citas/999999999/editar');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /agenda/:slug/citas (alta) — validaciones que no requieren una cita real', () => {
  it('sin token CSRF es rechazado', async () => {
    const agent = await loginAs(SOLO_CREAR);

    const res = await agent
      .post('/agenda/cirugias/citas')
      .type('form')
      .send({ doctorId: 1, mascotaId: 1, fechaHoraInicio: fechaFutura(), duracionMinutos: '30' });

    expect(res.status).toBe(403);
  });

  it('un usuario con SOLO agenda.cirugias.ver no puede crear (302, no llega a validar el body)', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getAgendaCsrfToken(agent, 'cirugias');

    const res = await agent
      .post('/agenda/cirugias/citas')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ doctorId: 1, mascotaId: 1, fechaHoraInicio: fechaFutura(), duracionMinutos: '30' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('AC: rechaza un doctor que no atiende esta área (ningún doctor real todavía, así que CUALQUIER id es "fuera de área")', async () => {
    const agent = await loginAs(SOLO_CREAR);
    const csrfToken = await getAgendaCsrfToken(agent, 'cirugias');

    const res = await agent
      .post('/agenda/cirugias/citas')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        doctorId: 999999999,
        mascotaId: 1,
        fechaHoraInicio: fechaFutura(),
        duracionMinutos: '30',
        motivo: `Cita ${SUFFIX}`,
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('no atiende esta área');
    expect(res.headers['hx-trigger']).toBeUndefined();
  });

  it('rechaza una duración fuera de los presets antes incluso de validar el doctor', async () => {
    const agent = await loginAs(SOLO_CREAR);
    const csrfToken = await getAgendaCsrfToken(agent, 'cirugias');

    const res = await agent
      .post('/agenda/cirugias/citas')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        doctorId: 999999999,
        mascotaId: 1,
        fechaHoraInicio: fechaFutura(),
        duracionMinutos: '37',
        motivo: `Cita ${SUFFIX}`,
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('duración');
  });
});

describe('DELETE /agenda/:slug/citas/:id (permiso .cancelar)', () => {
  it('una cita inexistente responde 404', async () => {
    const agent = await loginAs(SOLO_CANCELAR);
    const csrfToken = await getAgendaCsrfToken(agent, 'cirugias');

    const res = await agent
      .delete('/agenda/cirugias/citas/999999999')
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(404);
  });

  it('un usuario con SOLO agenda.cirugias.ver no puede cancelar', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.delete('/agenda/cirugias/citas/999999999');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('GET /agenda/:slug/citas.json (feed del calendario)', () => {
  it('AC: sin citas todavía, responde un arreglo vacío (nunca truena)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/agenda/cirugias/citas.json').query({
      start: new Date().toISOString(),
      end: fechaFutura(24),
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('requiere agenda.cirugias.ver', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/agenda/cirugias/citas.json').query({
      start: new Date().toISOString(),
      end: new Date().toISOString(),
    });

    expect(res.status).toBe(302);
  });
});
