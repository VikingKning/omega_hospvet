// US-606: catálogo de doctores. Requiere una base de datos real migrada y
// sembrada (ver tests/integration/auth.test.js para el porqué).
//
// Filtro/orden/paginación ya no viajan por query string (se ocultaron de la
// URL/historial por privacidad, vía HTMX): el GET siempre devuelve la
// página con el estado por defecto, y las variantes de filtro se prueban
// contra el POST que HTMX dispara, leyendo el token CSRF del hx-headers que
// el propio HTML ya renderizado expone (ver getDoctoresCsrfToken).
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SOLO_VER_USER = { username: 'solo.ver.doctores.test', password: 'SoloVerTest123!' };
const SIN_PERMISOS_USER = {
  username: 'sin.permisos.doctores.test',
  password: 'SinPermisosTest123!',
};
// US-607: usuarios con exactamente uno de los dos permisos de escritura,
// para probar el AC "editar sin crear (o viceversa) se rechaza, aunque el
// formulario sea el mismo".
const SOLO_CREAR_USER = { username: 'solo.crear.doctores.test', password: 'SoloCrearTest123!' };
const SOLO_EDITAR_USER = { username: 'solo.editar.doctores.test', password: 'SoloEditarTest123!' };
const SOLO_CREAR_USER2 = { username: 'solo.crear2.doctores.test', password: 'SoloCrear2Test123!' };
const SOLO_EDITAR_USER2 = {
  username: 'solo.editar2.doctores.test',
  password: 'SoloEditar2Test123!',
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
// login) — hay que leerlo de una carga de /doctores.html ya autenticada.
async function getDoctoresCsrfToken(agent) {
  const res = await agent.get('/doctores.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

// HTMX manda el <form> con la codificación por defecto de un form HTML
// (application/x-www-form-urlencoded), no JSON — .type('form') replica
// exactamente eso en vez de dejar que supertest mande JSON por default,
// para que el test ejercite la misma ruta de parseo que el navegador real.
async function filtrarDoctores(agent, body) {
  const csrfToken = await getDoctoresCsrfToken(agent);
  return agent.post('/doctores.html').type('form').set('x-csrf-token', csrfToken).send(body);
}

// Limpia únicamente lo que este archivo va a crear, identificado por un
// sufijo fijo en apellidos/slug, para no arrasar con datos de otras suites.
const SUFFIX = 'QA606';
async function cleanup() {
  const doctorIds = await db('doctores').where('apellidos', 'like', `%${SUFFIX}`).pluck('id');
  if (doctorIds.length) {
    await db('doctor_area').whereIn('doctor_id', doctorIds).del();
    await db('doctores').whereIn('id', doctorIds).del();
  }
  await db('areas').where('slug', 'like', `%-${SUFFIX.toLowerCase()}`).del();

  const usernames = [
    SOLO_VER_USER.username,
    SIN_PERMISOS_USER.username,
    SOLO_CREAR_USER.username,
    SOLO_EDITAR_USER.username,
    SOLO_CREAR_USER2.username,
    SOLO_EDITAR_USER2.username,
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
      apellidos: 'US606',
      correo: `${username}@omegavet.test`,
      username,
      password_hash: await bcrypt.hash(password, 4),
      activo: true,
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
  await createTestUser(SOLO_VER_USER, ['doctores.ver']);
  await createTestUser(SIN_PERMISOS_USER, []);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /doctores.html sin catálogo (US-606 AC1/AC3)', () => {
  it('muestra el estado vacío con CTA, sin la barra de herramientas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/doctores.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Todavía no hay doctores registrados');
    expect(res.text).toContain('Registrar primer doctor');
    expect(res.text).not.toContain('lab-toolbar');
  });
});

describe('GET /doctores.html con catálogo poblado', () => {
  beforeAll(async () => {
    const [areaCardio] = await db('areas')
      .insert({
        nombre: `Cardiología ${SUFFIX}`,
        slug: `cardiologia-${SUFFIX.toLowerCase()}`,
        creado_en: db.fn.now(),
      })
      .returning('id');

    const [activoConArea] = await db('doctores')
      .insert({
        nombre: 'Mariana',
        apellidos: `Gutiérrez ${SUFFIX}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    await db('doctores').insert({
      nombre: 'Paola',
      apellidos: `Aguilar ${SUFFIX}`,
      activo: true,
      creado_en: db.fn.now(),
    });
    await db('doctores').insert({
      nombre: 'Elena',
      apellidos: `Vieja ${SUFFIX}`,
      activo: false,
      creado_en: db.fn.now(),
    });

    await db('doctor_area').insert({ doctor_id: activoConArea.id, area_id: areaCardio.id });
  });

  it('AC2: la carga inicial lista activos, con áreas separadas por coma, y "Sin área asignada" cuando no tiene', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/doctores.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Gutiérrez ${SUFFIX}`);
    expect(res.text).toContain(`Cardiología ${SUFFIX}`);
    expect(res.text).toContain(`Aguilar ${SUFFIX}`);
    expect(res.text).toContain('Sin área asignada');
    expect(res.text).not.toContain(`Vieja ${SUFFIX}`); // inactivo, no debe aparecer por defecto
  });

  it('un GET con query string a mano se ignora por completo (privacidad: nunca se lee ni se refleja)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/doctores.html?estado=todos&q=Cardiolog');

    expect(res.text).not.toContain(`Vieja ${SUFFIX}`); // si leyera estado=todos, aparecería
  });

  it('POST con estado=todos incluye también a los inactivos', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarDoctores(agent, { estado: 'todos' });

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Vieja ${SUFFIX}`);
  });

  it('POST con q=Cardiolog encuentra al doctor por su área y muestra todas sus áreas, no solo la que coincidió', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarDoctores(agent, { q: 'Cardiolog' });

    expect(res.text).toContain(`Gutiérrez ${SUFFIX}`);
    expect(res.text).not.toContain(`Aguilar ${SUFFIX}`);
  });

  it('POST sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.post('/doctores.html').send({ estado: 'todos' });

    expect(res.status).toBe(403);
  });

  it('AC4/AC5/AC6: un usuario con solo doctores.ver no ve los botones de crear/editar/eliminar', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/doctores.html');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Nuevo doctor');
    expect(res.text).not.toContain('row-action-edit');
    expect(res.text).not.toContain('row-action-delete');
  });

  it('un usuario sin doctores.ver es rebotado a /main.html al pedir /doctores.html directo', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/doctores.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin doctores.ver recibe HX-Redirect (no un 302 normal) cuando la petición viene de HTMX', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent.post('/login').set('x-csrf-token', csrfToken).send(SIN_PERMISOS_USER);

    const res = await agent
      .post('/doctores.html')
      .set('HX-Request', 'true')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({ estado: 'todos' });

    expect(res.status).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/main.html');
  });

  describe('orden de la tabla por header (POST sort=&dir=)', () => {
    it('sort=doctor&dir=asc (por defecto) ordena por apellido ascendente', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarDoctores(agent, { estado: 'todos', sort: 'doctor', dir: 'asc' });

      const idxAguilar = res.text.indexOf(`Aguilar ${SUFFIX}`);
      const idxGutierrez = res.text.indexOf(`Gutiérrez ${SUFFIX}`);
      const idxVieja = res.text.indexOf(`Vieja ${SUFFIX}`);
      expect(idxAguilar).toBeLessThan(idxGutierrez);
      expect(idxGutierrez).toBeLessThan(idxVieja);
    });

    it('sort=doctor&dir=desc invierte el orden por apellido', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarDoctores(agent, { estado: 'todos', sort: 'doctor', dir: 'desc' });

      const idxAguilar = res.text.indexOf(`Aguilar ${SUFFIX}`);
      const idxGutierrez = res.text.indexOf(`Gutiérrez ${SUFFIX}`);
      const idxVieja = res.text.indexOf(`Vieja ${SUFFIX}`);
      expect(idxVieja).toBeLessThan(idxGutierrez);
      expect(idxGutierrez).toBeLessThan(idxAguilar);
    });

    it('sort=estado agrupa por activo/inactivo respetando la dirección', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const asc = await filtrarDoctores(agent, { estado: 'todos', sort: 'estado', dir: 'asc' });
      const desc = await filtrarDoctores(agent, { estado: 'todos', sort: 'estado', dir: 'desc' });

      // activo=false ordena antes que activo=true en ascendente, y al revés en descendente.
      expect(asc.text.indexOf(`Vieja ${SUFFIX}`)).toBeLessThan(
        asc.text.indexOf(`Gutiérrez ${SUFFIX}`),
      );
      expect(desc.text.indexOf(`Gutiérrez ${SUFFIX}`)).toBeLessThan(
        desc.text.indexOf(`Vieja ${SUFFIX}`),
      );
    });

    it('una columna de orden desconocida no truena, cae al orden por doctor', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarDoctores(agent, { estado: 'todos', sort: 'algo-invalido' });

      expect(res.status).toBe(200);
      expect(res.text).toContain(`Aguilar ${SUFFIX}`);
    });
  });
});

describe('DELETE /doctores/:id (US-608 — baja lógica)', () => {
  let doctorId;
  let doctorId2;

  // Dos doctores que comparten substring de búsqueda ("Baja") — necesario
  // para el test de abajo que reproduce el bug real reportado: HTMX manda
  // los valores incluidos vía hx-include como QUERY STRING en un DELETE
  // (`methodsThatUseUrlParams` trae "delete" por default, igual que "get"),
  // no como body. Un test que solo mande el body (como aquí antes) no
  // detecta esto — hay que usar `.query()` para simular lo que HTMX manda
  // de verdad.
  beforeAll(async () => {
    const [doctor] = await db('doctores')
      .insert({
        nombre: 'Sofía',
        apellidos: `Baja ${SUFFIX}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    doctorId = doctor.id;

    const [doctor2] = await db('doctores')
      .insert({
        nombre: 'Carlos',
        apellidos: `Bajado ${SUFFIX}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    doctorId2 = doctor2.id;
  });

  // Los tests de este describe dependen del orden (Jest corre los `it` de un
  // mismo archivo en orden, sin paralelizar): el primero desactiva al
  // doctor, el segundo confirma que sigue existiendo con estado=todos —
  // exactamente el flujo AC1/AC2 de la historia, no dos casos aislados.
  it('AC1/AC2: desactiva (activo=false, desactivado_por/desactivado_en), sin DELETE físico, y el fragmento respeta el filtro/búsqueda activos (bug real: HTMX manda estos valores por query string, no por body)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getDoctoresCsrfToken(agent);

    const res = await agent
      .delete(`/doctores/${doctorId}`)
      .query({ estado: 'activos', q: 'Baja' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`Baja ${SUFFIX}`); // recién desactivado, ya no aparece
    expect(res.text).toContain(`Bajado ${SUFFIX}`); // el otro match de "Baja" sigue activo
    // "1 resultados" es el assert que realmente distingue el bug: si el
    // fragmento hubiera vuelto al estado por defecto (req.body vacío en vez
    // de req.query), aparecerían TODOS los demás doctores activos de la
    // base (más de 1), no solo el que matchea q=Baja.
    expect(res.text).toContain('1 resultados');

    const row = await db('doctores').where({ id: doctorId }).first();
    expect(row.activo).toBe(false);
    expect(row.desactivado_por).not.toBeNull();
    expect(row.desactivado_en).not.toBeNull();
  });

  it('el registro sigue existiendo (no fue un DELETE físico) y aparece con estado=todos', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarDoctores(agent, { estado: 'todos' });

    expect(res.text).toContain(`Baja ${SUFFIX}`);
    expect(res.text).toContain('Inactivo');
  });

  it('sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.delete(`/doctores/${doctorId2}`).query({ estado: 'todos' });

    expect(res.status).toBe(403);
  });

  it('un usuario con doctores.ver pero sin doctores.eliminar es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.delete(`/doctores/${doctorId2}`).query({ estado: 'todos' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un id inválido no truena, responde 200 sin tronar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getDoctoresCsrfToken(agent);

    const res = await agent
      .delete('/doctores/no-es-un-id')
      .query({ estado: 'todos' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
  });
});

describe('GET /doctores/nuevo y GET /doctores/:id/editar (US-607 — formulario)', () => {
  let doctorId;
  let areaId;

  beforeAll(async () => {
    await createTestUser(SOLO_CREAR_USER, ['doctores.ver', 'doctores.crear']);
    await createTestUser(SOLO_EDITAR_USER, ['doctores.ver', 'doctores.editar']);

    const [area] = await db('areas')
      .insert({
        nombre: `Dermatología Form ${SUFFIX}`,
        slug: `dermatologia-form-${SUFFIX.toLowerCase()}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    areaId = area.id;

    const [doctor] = await db('doctores')
      .insert({
        nombre: 'Formulario',
        apellidos: `Precarga ${SUFFIX}`,
        activo: false,
        creado_en: db.fn.now(),
      })
      .returning('id');
    doctorId = doctor.id;
    await db('doctor_area').insert({ doctor_id: doctorId, area_id: areaId });
  });

  it('AC: el formulario de alta abre vacío, con título "Nuevo doctor" y el checkbox Activo marcado por defecto', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/doctores/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nuevo doctor');
    expect(res.text).not.toContain('Editar doctor');
    expect(res.text).toContain('name="activo" value="true" checked');
    expect(res.text).toContain('"seleccionadas":[]');
  });

  it('AC: el formulario de edición trae nombre/apellidos precargados, título "Editar doctor", y las áreas ya asignadas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/doctores/${doctorId}/editar`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Editar doctor');
    expect(res.text).toContain('value="Formulario"');
    expect(res.text).toContain(`value="Precarga ${SUFFIX}"`);
    expect(res.text).toContain(`Dermatología Form ${SUFFIX}`); // en la tabla de especialidades
    // El doctor de este fixture está inactivo — el ícono sigue mostrando el
    // formulario (AC confirmado: editar debe alcanzar también a inactivos,
    // es la única vía para reactivarlos desde el campo "Activo").
    expect(res.text).not.toContain('name="activo" value="true" checked');
  });

  it('un usuario sin doctores.crear no puede abrir el formulario de alta', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent.get('/doctores/nuevo');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin doctores.editar no puede abrir el formulario de edición', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await agent.get(`/doctores/${doctorId}/editar`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /doctores y PUT /doctores/:id (US-607 — alta y edición)', () => {
  let areaCardioId;
  let areaDermaId;

  beforeAll(async () => {
    await createTestUser(SOLO_CREAR_USER2, ['doctores.ver', 'doctores.crear']);
    await createTestUser(SOLO_EDITAR_USER2, ['doctores.ver', 'doctores.editar']);

    const [cardio] = await db('areas')
      .insert({
        nombre: `Cardiología Alta ${SUFFIX}`,
        slug: `cardiologia-alta-${SUFFIX.toLowerCase()}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    areaCardioId = cardio.id;

    const [derma] = await db('areas')
      .insert({
        nombre: `Dermatología Alta ${SUFFIX}`,
        slug: `dermatologia-alta-${SUFFIX.toLowerCase()}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    areaDermaId = derma.id;
  });

  async function crearDoctor(agent, { nombre, apellidos, activo = 'true', areaIds = [] }) {
    const csrfToken = await getDoctoresCsrfToken(agent);
    return agent
      .post('/doctores')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ nombre, apellidos, activo, areaIds });
  }

  async function editarDoctor(agent, id, { nombre, apellidos, activo = 'true', areaIds = [] }) {
    const csrfToken = await getDoctoresCsrfToken(agent);
    return agent
      .put(`/doctores/${id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ nombre, apellidos, activo, areaIds });
  }

  it('AC: alta sin id inserta el doctor y una fila en doctor_area por cada área seleccionada', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const apellidos = `Nueva ${SUFFIX}`;

    const res = await crearDoctor(agent, {
      nombre: 'Alta',
      apellidos,
      areaIds: [String(areaCardioId), String(areaDermaId)],
    });

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeDoctorModal');
    expect(res.text).toContain('hx-swap-oob="true"');

    const doctor = await db('doctores').where({ apellidos }).first();
    expect(doctor).toBeDefined();
    expect(doctor.activo).toBe(true);
    expect(doctor.creado_por).not.toBeNull();

    const areas = await db('doctor_area').where({ doctor_id: doctor.id }).pluck('area_id');
    expect(areas.sort()).toEqual([areaCardioId, areaDermaId].sort());
  });

  it('AC: guardar sin seleccionar ninguna área se permite igual (el doctor queda sin área asignada)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const apellidos = `SinArea ${SUFFIX}`;

    const res = await crearDoctor(agent, { nombre: 'Alta', apellidos, areaIds: [] });

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeDoctorModal');

    const doctor = await db('doctores').where({ apellidos }).first();
    const areas = await db('doctor_area').where({ doctor_id: doctor.id });
    expect(areas).toHaveLength(0);
  });

  it('un nombre vacío no truena: re-renderiza el formulario con el error, sin cerrar el modal ni crear el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const apellidos = `NombreVacio ${SUFFIX}`;

    const res = await crearDoctor(agent, { nombre: '   ', apellidos, areaIds: [] });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nombre(s) es obligatorio');
    expect(res.headers['hx-trigger']).toBeUndefined();
    expect(res.text).not.toContain('hx-swap-oob');

    const doctor = await db('doctores').where({ apellidos }).first();
    expect(doctor).toBeUndefined();
  });

  it('AC: la edición actualiza doctores y AJUSTA doctor_area (agrega nuevas, quita las que ya no están)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const apellidos = `ParaEditar ${SUFFIX}`;
    await crearDoctor(agent, { nombre: 'Editable', apellidos, areaIds: [String(areaCardioId)] });
    const doctor = await db('doctores').where({ apellidos }).first();

    const res = await editarDoctor(agent, doctor.id, {
      nombre: 'Editado',
      apellidos,
      areaIds: [String(areaDermaId)], // quita cardio, agrega derma
    });

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeDoctorModal');

    const actualizado = await db('doctores').where({ id: doctor.id }).first();
    expect(actualizado.nombre).toBe('Editado');
    expect(actualizado.actualizado_por).not.toBeNull();
    expect(actualizado.actualizado_en).not.toBeNull();

    const areas = await db('doctor_area').where({ doctor_id: doctor.id }).pluck('area_id');
    expect(areas).toEqual([areaDermaId]);
  });

  it('AC: desmarcar "Activo" al editar da de baja al doctor (desactivado_por/desactivado_en) igual que el ícono de baja', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const apellidos = `DesactivarPorForm ${SUFFIX}`;
    await crearDoctor(agent, { nombre: 'Activo', apellidos, areaIds: [] });
    const doctor = await db('doctores').where({ apellidos }).first();

    const res = await editarDoctor(agent, doctor.id, {
      nombre: 'Activo',
      apellidos,
      activo: 'false',
    });

    expect(res.status).toBe(200);
    const actualizado = await db('doctores').where({ id: doctor.id }).first();
    expect(actualizado.activo).toBe(false);
    expect(actualizado.desactivado_por).not.toBeNull();
    expect(actualizado.desactivado_en).not.toBeNull();
  });

  it('AC: marcar "Activo" al editar REACTIVA a un doctor inactivo (limpia desactivado_por/desactivado_en)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const apellidos = `ReactivarPorForm ${SUFFIX}`;
    await crearDoctor(agent, { nombre: 'Inactivo', apellidos, activo: 'false', areaIds: [] });
    const doctor = await db('doctores').where({ apellidos }).first();
    expect(doctor.activo).toBe(false);

    const res = await editarDoctor(agent, doctor.id, {
      nombre: 'Inactivo',
      apellidos,
      activo: 'true',
    });

    expect(res.status).toBe(200);
    const actualizado = await db('doctores').where({ id: doctor.id }).first();
    expect(actualizado.activo).toBe(true);
    expect(actualizado.desactivado_por).toBeNull();
    expect(actualizado.desactivado_en).toBeNull();
  });

  it('POST /doctores sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent
      .post('/doctores')
      .type('form')
      .send({ nombre: 'Sin', apellidos: `Csrf ${SUFFIX}`, activo: 'true' });

    expect(res.status).toBe(403);
  });

  it('AC: un usuario con doctores.editar pero SIN doctores.crear no puede dar de alta, aunque el formulario sea el mismo', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER2);

    const res = await agent
      .post('/doctores')
      .type('form')
      .send({ nombre: 'Sin', apellidos: `PermisoCrear ${SUFFIX}`, activo: 'true' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const doctor = await db('doctores').where('apellidos', `PermisoCrear ${SUFFIX}`).first();
    expect(doctor).toBeUndefined();
  });

  it('AC: un usuario con doctores.crear pero SIN doctores.editar no puede editar, aunque el formulario sea el mismo', async () => {
    const adminAgent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const apellidos = `PermisoEditar ${SUFFIX}`;
    await crearDoctor(adminAgent, { nombre: 'Original', apellidos, areaIds: [] });
    const doctor = await db('doctores').where({ apellidos }).first();

    const agent = await loginAs(SOLO_CREAR_USER2);
    const res = await agent
      .put(`/doctores/${doctor.id}`)
      .type('form')
      .send({ nombre: 'Modificado', apellidos, activo: 'true' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const sinCambios = await db('doctores').where({ id: doctor.id }).first();
    expect(sinCambios.nombre).toBe('Original'); // no se tocó
  });
});
