// Reconstrucción del menú de navegación: el submenú "Agenda" del sidebar
// lista cada ÁREA activa de la tabla `areas` como su propia fila, filtrada
// por el permiso granular agenda_<slug>.ver de la sesión — en vez de los 2
// links fijos (Consultas/Cirugías, Grooming) de antes. También agrega
// "Tutores y pacientes" como link de nivel superior (gateado por
// tutores.ver; desde US-155 ya navega a una página real, tutores.html —
// antes de esa historia era un placeholder href="#").
//
// Ajuste posterior (calendario genérico por área, ver agenda.routes.js):
// /agenda.html y /grooming.html (mockups combinados/fijos) ya no existen —
// cada área tiene su propia página real en /agenda/<slug>.html, así que ya
// no queda ninguna en estado "Próximamente" (ese estado, y los tests que lo
// cubrían, se retiraron junto con esto).
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

async function getCsrfToken(agent) {
  const res = await agent.get('/');
  const match = res.text.match(/id="csrfToken" value="([^"]+)"/);
  return match[1];
}

async function loginAs(agent, credentials) {
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/login').set('x-csrf-token', csrfToken).send(credentials);
}

async function createTestUser(username, password, permissionCodes) {
  const [{ id: usuarioId }] = await db('usuarios')
    .insert({
      nombre: 'Test',
      apellidos: 'SidebarAgenda',
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
  return usuarioId;
}

const SOLO_CONSULTAS = { username: 'sidebar.consultas.test', password: 'SidebarConsultasTest123!' };
const SOLO_CARDIOLOGIA = {
  username: 'sidebar.cardiologia.test',
  password: 'SidebarCardiologiaTest123!',
};
const SOLO_GROOMING = { username: 'sidebar.grooming.test', password: 'SidebarGroomingTest123!' };
const SOLO_TUTORES = { username: 'sidebar.tutores.test', password: 'SidebarTutoresTest123!' };
const SIN_AGENDA = { username: 'sidebar.sinagenda.test', password: 'SidebarSinAgendaTest123!' };

async function cleanup() {
  const usernames = [
    SOLO_CONSULTAS.username,
    SOLO_CARDIOLOGIA.username,
    SOLO_GROOMING.username,
    SOLO_TUTORES.username,
    SIN_AGENDA.username,
  ];
  const ids = await db('usuarios').whereIn('username', usernames).pluck('id');
  if (ids.length) {
    await db('usuario_permisos').whereIn('usuario_id', ids).del();
    await db('usuarios').whereIn('id', ids).del();
  }
}

beforeAll(async () => {
  await cleanup();
  await createTestUser(SOLO_CONSULTAS.username, SOLO_CONSULTAS.password, ['agenda.consultas.ver']);
  await createTestUser(SOLO_CARDIOLOGIA.username, SOLO_CARDIOLOGIA.password, [
    'agenda.cardiologia.ver',
  ]);
  await createTestUser(SOLO_GROOMING.username, SOLO_GROOMING.password, ['agenda.grooming.ver']);
  await createTestUser(SOLO_TUTORES.username, SOLO_TUTORES.password, ['tutores.ver']);
  await createTestUser(SIN_AGENDA.username, SIN_AGENDA.password, ['laboratorio.ver']);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('Sidebar — submenú "Agenda" dinámico por área', () => {
  it('AC: un usuario con agenda_consultas.ver ve "Consultas" como link real y puede entrar a /agenda/consultas.html', async () => {
    const agent = request.agent(app);
    await loginAs(agent, SOLO_CONSULTAS);

    const res = await agent.get('/main.html');
    expect(res.text).toMatch(
      /<a href="agenda\/consultas\.html" class="submenu-link[^"]*">[\s\S]*?Consultas/,
    );

    const paginaRes = await agent.get('/agenda/consultas.html');
    expect(paginaRes.status).toBe(200);
  });

  it('AC: el calendario genérico por área también funciona para un área sin página fija de antes (agenda_cardiologia.ver) — ya no queda ninguna "Próximamente"', async () => {
    const agent = request.agent(app);
    await loginAs(agent, SOLO_CARDIOLOGIA);

    const res = await agent.get('/main.html');
    expect(res.text).toMatch(
      /<a href="agenda\/cardiologia\.html" class="submenu-link[^"]*">[\s\S]*?Cardiología/,
    );
    expect(res.text).not.toContain('Próximamente');
    expect(res.text).not.toContain('is-disabled');

    const paginaRes = await agent.get('/agenda/cardiologia.html');
    expect(paginaRes.status).toBe(200);
  });

  it('un usuario sin NINGÚN permiso agenda_<slug>.ver no ve el grupo "Agenda" en absoluto', async () => {
    const agent = request.agent(app);
    await loginAs(agent, SIN_AGENDA);

    const res = await agent.get('/main.html');
    expect(res.text).not.toContain('id="agenda-menu"');
  });

  it('AC: agenda_grooming.ver da acceso real a /agenda/grooming.html', async () => {
    const agent = request.agent(app);
    await loginAs(agent, SOLO_GROOMING);

    const res = await agent.get('/main.html');
    expect(res.text).toMatch(
      /<a href="agenda\/grooming\.html" class="submenu-link[^"]*">[\s\S]*?Grooming/,
    );

    const paginaRes = await agent.get('/agenda/grooming.html');
    expect(paginaRes.status).toBe(200);
  });

  it('un usuario SIN agenda_consultas.ver no puede acceder a /agenda/consultas.html (permiso es por área, no compartido)', async () => {
    const agent = request.agent(app);
    await loginAs(agent, SOLO_GROOMING);

    const res = await agent.get('/agenda/consultas.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('Sidebar — "Tutores y pacientes"', () => {
  it('AC: con tutores.ver, aparece el link y navega a tutores.html (US-155)', async () => {
    const agent = request.agent(app);
    await loginAs(agent, SOLO_TUTORES);

    const res = await agent.get('/main.html');
    expect(res.text).toMatch(
      /<a href="tutores\.html" class="nav-link[^"]*">[\s\S]*?Tutores y pacientes/,
    );
  });

  it('sin tutores.ver, no aparece el link', async () => {
    const agent = request.agent(app);
    await loginAs(agent, SIN_AGENDA);

    const res = await agent.get('/main.html');
    expect(res.text).not.toContain('Tutores y pacientes');
  });
});
