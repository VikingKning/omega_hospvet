// US-155: catálogo de Tutores y Pacientes (listado). Primera historia del
// módulo — las tablas `propietarios`/`mascotas` ya existían en el schema
// (migradas y sembradas con sus permisos desde US-000) pero ningún otro
// archivo de test las toca todavía, así que no hay riesgo de colisión
// entre archivos corriendo en paralelo (a diferencia de `usuarios`/
// `doctores`/`session`, ver memoria del proyecto) — aun así se usa un
// SUFFIX único para poder buscar/limpiar exactamente los datos de este
// archivo sin depender de que la tabla esté vacía al arrancar.
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SOLO_VER_USER = { username: 'solo.ver.tutores.test', password: 'SoloVerTest123!' };
const SIN_PERMISOS_USER = {
  username: 'sin.permisos.tutores.test',
  password: 'SinPermisosTest123!',
};
// US-156 AC21/AC22: crear y editar son permisos independientes — un usuario
// con solo uno de los dos nunca debe poder ejecutar el otro.
const SOLO_CREAR_USER = { username: 'solo.crear.tutores.test', password: 'SoloCrearTest123!' };
const SOLO_EDITAR_USER = { username: 'solo.editar.tutores.test', password: 'SoloEditarTest123!' };

const SUFFIX = 'QA155';
const PAG_SUFFIX = 'QA155PAG';
const SUFFIX_156 = 'QA156';

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

async function getTutoresCsrfToken(agent) {
  const res = await agent.get('/tutores.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

// US-156: tutor-form.ejs no usa hx-headers (no es HTMX) — el token viaja en
// `const csrfToken = '...'` dentro del <script>, embebido tanto en
// GET /tutores/nuevo como en GET /tutores/:id/editar.
async function getTutorFormCsrfToken(agent, path) {
  const res = await agent.get(path);
  const match = res.text.match(/const csrfToken = '([^']+)'/);
  return match[1];
}

async function postTutor(agent, body) {
  const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');
  return agent.post('/tutores').set('x-csrf-token', csrfToken).send(body);
}

async function putTutor(agent, id, body) {
  const csrfToken = await getTutorFormCsrfToken(agent, `/tutores/${id}/editar`);
  return agent.put(`/tutores/${id}`).set('x-csrf-token', csrfToken).send(body);
}

async function filtrarTutores(agent, body) {
  const csrfToken = await getTutoresCsrfToken(agent);
  return agent.post('/tutores.html').type('form').set('x-csrf-token', csrfToken).send(body);
}

async function cleanup() {
  // "contains", no un SUFFIX exacto: incluye tanto los datos fijos de
  // US-155 (SUFFIX) como los del alta/edición de US-156 (SUFFIX_156). Se
  // busca por NOMBRE en ambos casos — desde que tutores.telefono exige el
  // formato NN-NNNN-NNNN (pedido del usuario, aplicado en todo el sistema),
  // ya no se puede incrustar un sufijo de aislamiento legible ahí como
  // antes; cada propietario creado por este archivo siempre lleva su
  // SUFFIX/SUFFIX_156 en el nombre de todos modos.
  const propietarioIds = await db('propietarios')
    .where('nombre', 'like', `%${SUFFIX}%`)
    .orWhere('nombre', 'like', `%${SUFFIX_156}%`)
    .orWhere('apellidos', 'like', `%${SUFFIX}%`)
    .orWhere('apellidos', 'like', `%${SUFFIX_156}%`)
    .pluck('id');
  if (propietarioIds.length) {
    await db('mascotas').whereIn('propietario_id', propietarioIds).del();
    await db('propietarios').whereIn('id', propietarioIds).del();
  }

  const usernames = [
    SOLO_VER_USER.username,
    SIN_PERMISOS_USER.username,
    SOLO_CREAR_USER.username,
    SOLO_EDITAR_USER.username,
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
      apellidos: 'US155',
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

async function crearTutor({ nombre, apellidos, telefono, correo, activo }) {
  // El servidor guarda `propietarios.telefono` sin guiones (look and feel
  // solo, ver tutores.service.js#stripTelefono) — este helper inserta
  // directo a BD saltándose el servicio, así que replica esa misma
  // normalización a mano para no dejar filas con guiones que ningún flujo
  // real produciría.
  const [{ id }] = await db('propietarios')
    .insert({
      nombre,
      apellidos,
      telefono: (telefono ?? '').replace(/-/g, ''),
      correo,
      activo,
      creado_en: db.fn.now(),
    })
    .returning('id');
  return id;
}

async function crearMascota(propietarioId, { nombre, tipo, raza, activo }) {
  const [{ id }] = await db('mascotas')
    .insert({ propietario_id: propietarioId, nombre, tipo, raza, activo, creado_en: db.fn.now() })
    .returning('id');
  return id;
}

let anaId;
let carlaId;

beforeAll(async () => {
  await cleanup();
  await createTestUser(SOLO_VER_USER, ['tutores.ver']);
  await createTestUser(SIN_PERMISOS_USER, []);
  await createTestUser(SOLO_CREAR_USER, ['tutores.ver', 'tutores.crear']);
  await createTestUser(SOLO_EDITAR_USER, ['tutores.ver', 'tutores.editar']);

  anaId = await crearTutor({
    nombre: 'Ana',
    // El SUFFIX de aislamiento va en apellidos — un teléfono digit-only no
    // tiene dónde incrustar letras (y contaminaría las búsquedas por
    // teléfono si se intentara con solo sus dígitos, ver AC26 más abajo).
    apellidos: `García ${SUFFIX}`,
    telefono: '5550001001',
    correo: `ana.garcia.${SUFFIX.toLowerCase()}@correo.test`,
    activo: true,
  });
  await crearMascota(anaId, {
    nombre: `Firulais ${SUFFIX}`,
    tipo: 'Perro',
    raza: 'Labrador',
    activo: true,
  });
  await crearMascota(anaId, {
    nombre: `Michi ${SUFFIX}`,
    tipo: 'Gato',
    raza: 'Siamés',
    activo: false,
  });

  await crearTutor({
    nombre: 'Beto',
    apellidos: `López ${SUFFIX}`,
    telefono: '5550001002',
    correo: null,
    activo: true,
  });
  // Beto no tiene pacientes — AC7 ("No hay pacientes para mostrar.").

  carlaId = await crearTutor({
    nombre: 'Carla',
    apellidos: `Ruiz ${SUFFIX}`,
    telefono: '5550001003',
    correo: null,
    activo: false,
  });
  await crearMascota(carlaId, {
    nombre: `Rocky ${SUFFIX}`,
    tipo: 'Perro',
    raza: 'Poodle',
    activo: true,
  });

  // 11 tutores dedicados y aislados (su propio SUFFIX de búsqueda) solo
  // para la paginación — 10 en la página 1, 1 en la página 2.
  for (let i = 1; i <= 11; i += 1) {
    await crearTutor({
      nombre: 'Filler',
      apellidos: `${String(i).padStart(2, '0')} ${PAG_SUFFIX}`,
      telefono: `55500020${String(i).padStart(2, '0')}`,
      correo: null,
      activo: true,
    });
  }
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /tutores.html (US-155 AC1-AC7: listado, columnas y pacientes agrupados)', () => {
  it('AC1/AC2/AC3: la carga inicial lista tutores activos con pacientes activos por defecto', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/tutores.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Ana García ${SUFFIX}`);
    expect(res.text).toContain(`Beto López ${SUFFIX}`);
    expect(res.text).not.toContain(`Carla Ruiz ${SUFFIX}`); // inactiva, no aparece por defecto
  });

  it('un GET con query string a mano se ignora por completo (privacidad, mismo criterio que áreas/doctores)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/tutores.html?estadoTutores=todos&q=${SUFFIX}`);

    expect(res.text).not.toContain(`Carla Ruiz ${SUFFIX}`); // si leyera estadoTutores=todos, aparecería
  });

  it('AC4: la tabla trae Propietario, Estado, Pacientes asociados y Acciones', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: SUFFIX });

    expect(res.text).toContain('Propietario');
    expect(res.text).toContain('Pacientes asociados');
    expect(res.text).toContain('Acciones');
  });

  it('AC5/AC6: un tutor con varios pacientes muestra tipo/nombre/raza/estado de CADA UNO, agrupados por propietario_id', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, {
      q: `Ana García ${SUFFIX}`,
      estadoPacientes: 'todos',
    });

    expect(res.text).toContain(`Firulais ${SUFFIX}`);
    expect(res.text).toContain('Labrador');
    // Michi es de Ana pero está inactiva — con estadoPacientes=todos igual aparece.
    expect(res.text).toContain(`Michi ${SUFFIX}`);
    expect(res.text).toContain('Siamés');
  });

  it('AC7: un tutor sin pacientes (o sin ninguno que cumpla el filtro) muestra el mensaje exacto', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: `Beto López ${SUFFIX}` });

    expect(res.text).toContain('No hay pacientes para mostrar.');
  });

  it('AC7 (variante): Ana con Pacientes:Activos no muestra a Michi (inactiva) y su fila igual entra a la tabla', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, {
      q: `Ana García ${SUFFIX}`,
      estadoPacientes: 'activos',
    });

    expect(res.text).toContain(`Ana García ${SUFFIX}`);
    expect(res.text).toContain(`Firulais ${SUFFIX}`);
    expect(res.text).not.toContain(`Michi ${SUFFIX}`);
  });
});

describe('POST /tutores.html — búsqueda (US-155 AC8-AC10)', () => {
  it('AC8: el texto coincide con el nombre del tutor', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: `Ana García ${SUFFIX}` });

    expect(res.text).toContain(`Ana García ${SUFFIX}`);
    expect(res.text).not.toContain(`Beto López ${SUFFIX}`);
  });

  it('AC10: el texto también coincide con teléfono y correo del tutor', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const porTelefono = await filtrarTutores(agent, { q: '5550001001' });
    expect(porTelefono.text).toContain(`Ana García ${SUFFIX}`);

    const porCorreo = await filtrarTutores(agent, {
      q: `ana.garcia.${SUFFIX.toLowerCase()}@correo.test`,
    });
    expect(porCorreo.text).toContain(`Ana García ${SUFFIX}`);
  });

  it('AC9/AC10: el texto que coincide con un paciente muestra al tutor junto SOLO con los pacientes que coinciden', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: `Firulais ${SUFFIX}` });

    expect(res.text).toContain(`Ana García ${SUFFIX}`); // el tutor aparece
    expect(res.text).toContain(`Firulais ${SUFFIX}`); // el paciente que coincidió
    // Michi es inactiva (no pasa el filtro de Pacientes) y además no coincide
    // con la búsqueda — no debería aparecer bajo Ana en este resultado.
    expect(res.text).not.toContain(`Michi ${SUFFIX}`);
  });

  it('AC10: la búsqueda por paciente también coincide por tipo o raza', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const porTipo = await filtrarTutores(agent, { q: 'Labrador' });
    expect(porTipo.text).toContain(`Ana García ${SUFFIX}`);
    expect(porTipo.text).toContain(`Firulais ${SUFFIX}`);
  });

  it('una búsqueda sin coincidencias no truena y muestra el mensaje de "sin resultados"', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: `nada-coincide-${SUFFIX}` });

    expect(res.status).toBe(200);
    expect(res.text).toContain('No hay resultados para tu búsqueda.');
  });
});

describe('POST /tutores.html — filtros independientes de estado (US-155 AC11-AC15)', () => {
  it('AC11: Tutores:Activos (default) excluye a los tutores inactivos', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: SUFFIX, estadoTutores: 'activos' });

    expect(res.text).not.toContain(`Carla Ruiz ${SUFFIX}`);
  });

  it('AC12: Tutores:Todos incluye tutores activos e inactivos, mostrando su estado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: SUFFIX, estadoTutores: 'todos' });

    expect(res.text).toContain(`Carla Ruiz ${SUFFIX}`);
    expect(res.text).toContain('Inactivo');
  });

  it('AC13: Pacientes:Activos (default) excluye pacientes inactivos de un tutor visible', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, {
      q: `Ana García ${SUFFIX}`,
      estadoPacientes: 'activos',
    });

    expect(res.text).not.toContain(`Michi ${SUFFIX}`);
  });

  it('AC14: Pacientes:Todos incluye pacientes activos e inactivos', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, {
      q: `Ana García ${SUFFIX}`,
      estadoPacientes: 'todos',
    });

    expect(res.text).toContain(`Michi ${SUFFIX}`);
  });

  it('AC15: los filtros de Tutores y Pacientes se aplican de forma conjunta e independiente', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    // Carla es inactiva (Tutores:Todos la trae) y su único paciente, Rocky,
    // está activo (Pacientes:Activos lo conserva) — ambos filtros deben
    // cumplirse a la vez sin que uno pise al otro.
    const res = await filtrarTutores(agent, {
      q: `Carla Ruiz ${SUFFIX}`,
      estadoTutores: 'todos',
      estadoPacientes: 'activos',
    });

    expect(res.text).toContain(`Carla Ruiz ${SUFFIX}`);
    expect(res.text).toContain(`Rocky ${SUFFIX}`);
  });
});

describe('Permisos (US-155 AC16-AC21, AC29)', () => {
  it('AC16: con tutores.crear se ve el botón "+ Nuevo Propietario"', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/tutores.html');

    expect(res.text).toContain('Nuevo Propietario');
  });

  it('AC17: sin tutores.crear no se ve el botón "+ Nuevo Propietario"', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/tutores.html');

    expect(res.text).not.toContain('Nuevo Propietario');
  });

  it('AC18: con tutores.editar se ve el ícono de Editar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: SUFFIX });

    expect(res.text).toContain('row-action-edit');
  });

  it('AC19: sin tutores.editar no se ve el ícono de Editar', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/tutores.html');

    expect(res.text).not.toContain('row-action-edit');
  });

  it('AC20: con tutores.eliminar se ve el ícono de Eliminar en un tutor activo', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: `Ana García ${SUFFIX}` });

    expect(res.text).toContain('row-action-delete');
  });

  it('AC21: sin tutores.eliminar no se ve el ícono de Eliminar', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/tutores.html');

    expect(res.text).not.toContain('row-action-delete');
  });

  it('AC22: los íconos de acción traen data-tooltip (estándar transversal de tooltips)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: `Ana García ${SUFFIX}` });

    expect(res.text).toContain('data-tooltip="Editar"');
    expect(res.text).toContain('data-tooltip="Eliminar"');
  });

  it('AC29: sin tutores.ver el acceso directo al módulo se rechaza (302 a /main.html)', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/tutores.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('sin tutores.ver, una petición HTMX recibe HX-Redirect en vez de un 302 normal', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent
      .post('/tutores.html')
      .set('HX-Request', 'true')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/main.html');
  });
});

describe('Paginación (US-155 AC23-AC26)', () => {
  it('AC23: 10 tutores por página', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: PAG_SUFFIX });

    const matches =
      res.text.match(new RegExp(`person-cell-name">Filler \\d\\d ${PAG_SUFFIX}`, 'g')) ?? [];
    expect(matches.length).toBe(10);
    expect(res.text).toContain('11 tutores en total');
  });

  it('AC24: la página 2 trae el resultado restante', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: PAG_SUFFIX, page: 2 });

    const matches =
      res.text.match(new RegExp(`person-cell-name">Filler \\d\\d ${PAG_SUFFIX}`, 'g')) ?? [];
    expect(matches.length).toBe(1);
  });

  it('AC25: al cambiar la búsqueda, la paginación se recalcula solo con los tutores que ya cumplen', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: `Filler 01 ${PAG_SUFFIX}` });

    expect(res.text).toContain('1 resultados');
    expect(res.text).toContain('1 tutores en total');
    expect(res.text).not.toContain('pagination'); // 1 sola página, sin nav
  });

  it('AC26: el footer muestra el texto exacto "[encontrados] resultados – [total] tutores en total"', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: PAG_SUFFIX });

    expect(res.text).toContain('10 resultados – 11 tutores en total');
  });
});

describe('GET /tutores/nuevo y GET /tutores/:id/editar (US-156 AC1/AC2 — formulario)', () => {
  it('AC1: con tutores.crear, el formulario de alta abre vacío con el título "Nuevo propietario"', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await agent.get('/tutores/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nuevo propietario');
    expect(res.text).not.toContain(`Ana García ${SUFFIX}`);
  });

  it('sin tutores.crear, el formulario de alta se rechaza', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent.get('/tutores/nuevo');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('AC2/AC14: con tutores.editar, el formulario de edición precarga tutor y pacientes con título "Editar propietario"', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent.get(`/tutores/${anaId}/editar`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Editar propietario');
    // nombre/apellidos precargan como 2 inputs separados (ver
    // tutor-form.ejs) — ya no hay un "Resumen" que los concatene en un
    // solo texto.
    expect(res.text).toContain('value="Ana"');
    expect(res.text).toContain(`value="García ${SUFFIX}"`);
    expect(res.text).toContain(`Firulais ${SUFFIX}`); // isla de datos con las mascotas precargadas
  });

  it('sin tutores.editar, el formulario de edición se rechaza', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await agent.get(`/tutores/${anaId}/editar`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un id inexistente responde 404', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent.get('/tutores/999999/editar');

    expect(res.status).toBe(404);
  });
});

describe('POST /tutores (US-156 AC3-AC13 — alta)', () => {
  it('AC3/AC4: nombre y teléfono son obligatorios', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await postTutor(agent, { nombre: '', telefono: '', pacientes: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obligatorio/);
  });

  it('AC7/AC8: alta válida crea el propietario activo con auditoría, sin pacientes', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await postTutor(agent, {
      nombre: 'Alta',
      apellidos: `Sin Pacientes ${SUFFIX_156}`,
      telefono: '55-1000-0001',
      correo: '',
      pacientes: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.propietario.activo).toBe(true);
    expect(res.body.propietario.pacientes).toEqual([]);

    const row = await db('propietarios').where({ id: res.body.id }).first();
    expect(row.activo).toBe(true);
    expect(row.creado_por).not.toBeNull();
    expect(row.creado_en).not.toBeNull();
  });

  // Pedido del usuario, posterior al AC: el teléfono sigue el mismo formato
  // mexicano ya establecido en el resto del sistema (NN-NNNN-NNNN,
  // perfil.service.js#TELEFONO_REGEX) — a diferencia de un texto libre
  // cualquiera, el servidor rechaza cualquier cosa que no cumpla el patrón.
  it('el teléfono debe tener el formato NN-NNNN-NNNN establecido en el resto del sistema', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await postTutor(agent, {
      nombre: 'Formato',
      apellidos: `Invalido ${SUFFIX_156}`,
      telefono: '5510000099', // sin guiones — mismo dato, formato distinto
      pacientes: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('El teléfono debe tener el formato NN-NNNN-NNNN o NNN-NNN-NNNN.');
  });

  it('AC9/AC10/AC12/AC13: alta con varios pacientes los crea activos y asociados por propietario_id', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await postTutor(agent, {
      nombre: 'Alta',
      apellidos: `Con Pacientes ${SUFFIX_156}`,
      telefono: '55-1000-0002',
      pacientes: [
        { nombre: 'Firulais', tipo: 'Perro', raza: 'Labrador' },
        { nombre: 'Michi', tipo: 'Gato', raza: 'Siamés' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.propietario.pacientes).toHaveLength(2);

    const mascotas = await db('mascotas').where({ propietario_id: res.body.id });
    expect(mascotas).toHaveLength(2);
    expect(mascotas.every((m) => m.activo === true)).toBe(true);
    expect(mascotas.every((m) => m.creado_por !== null)).toBe(true);
  });

  it('AC5: un teléfono que ya pertenece a otro propietario ACTIVO se rechaza', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const telefono = '55-1000-0005';
    await crearTutor({
      nombre: 'Existente',
      apellidos: `Activo ${SUFFIX_156}`,
      telefono,
      correo: null,
      activo: true,
    });

    const res = await postTutor(agent, {
      nombre: 'Duplicado',
      apellidos: SUFFIX_156,
      telefono,
      pacientes: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ya se encuentra registrado/);
  });

  it('AC5 (decidido con el usuario): un teléfono de un propietario INACTIVO pide confirmación antes de reactivar', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const telefono = '55-1000-0003';
    const telefonoDigits = telefono.replace(/-/g, '');
    const inactivoId = await crearTutor({
      nombre: 'Reactivable',
      apellidos: SUFFIX_156,
      telefono,
      correo: null,
      activo: false,
    });

    const sinConfirmar = await postTutor(agent, {
      nombre: 'Nombre',
      apellidos: `Nuevo ${SUFFIX_156}`,
      telefono,
      pacientes: [],
    });

    expect(sinConfirmar.status).toBe(200);
    expect(sinConfirmar.body.requiereConfirmacion).toBe(true);
    expect(sinConfirmar.body.tutorExistente).toEqual({
      nombre: 'Reactivable',
      apellidos: SUFFIX_156,
      telefono,
    });

    const noSeCreoNada = await db('propietarios')
      .where({ telefono: telefonoDigits })
      .count('id as total')
      .first();
    expect(Number(noSeCreoNada.total)).toBe(1); // sigue siendo solo el inactivo original

    const confirmado = await postTutor(agent, {
      nombre: 'Nombre',
      apellidos: `Nuevo ${SUFFIX_156}`,
      telefono,
      pacientes: [{ nombre: 'Nueva Mascota' }],
      confirmarReactivacion: true,
    });

    expect(confirmado.status).toBe(200);
    expect(confirmado.body.id).toBe(inactivoId); // reactivó el MISMO registro, no creó uno nuevo

    const reactivado = await db('propietarios').where({ id: inactivoId }).first();
    expect(reactivado.activo).toBe(true);
    expect(reactivado.nombre).toBe('Nombre');
    expect(reactivado.apellidos).toBe(`Nuevo ${SUFFIX_156}`);
    expect(reactivado.desactivado_por).toBeNull();
    expect(reactivado.desactivado_en).toBeNull();

    const totalFinal = await db('propietarios')
      .where({ telefono: telefonoDigits })
      .count('id as total')
      .first();
    expect(Number(totalFinal.total)).toBe(1); // nunca se insertó un segundo registro
  });

  // Ajuste posterior (pedido del usuario): el formulario de alta ahora
  // puede precargarse con las mascotas YA EXISTENTES del propietario
  // inactivo (para "mostrar toda su información y mascotas" antes de
  // reactivar) — regresión real que este test cubre: reactivar() antes
  // insertaba TODO el arreglo de `pacientes` a ciegas, ignorando `id`, así
  // que una mascota precargada se hubiera duplicado en vez de actualizarse.
  it('reactivar con una mascota YA EXISTENTE (con id) la actualiza, nunca la duplica', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const telefono = '55-1000-0009';
    const inactivoId = await crearTutor({
      nombre: 'ReactivableConMascota',
      apellidos: SUFFIX_156,
      telefono,
      correo: null,
      activo: false,
    });
    const mascotaId = await crearMascota(inactivoId, {
      nombre: 'Mascota Precargada',
      tipo: 'Gato',
      raza: 'Persa',
      activo: true,
    });

    const confirmado = await postTutor(agent, {
      nombre: 'ReactivableConMascota',
      apellidos: SUFFIX_156,
      telefono,
      correo: null,
      pacientes: [
        {
          id: mascotaId,
          nombre: 'Mascota Precargada Editada',
          tipo: 'Gato',
          raza: 'Persa',
          activo: true,
        },
      ],
      confirmarReactivacion: true,
    });

    expect(confirmado.status).toBe(200);
    expect(confirmado.body.id).toBe(inactivoId);

    const mascotas = await db('mascotas').where({ propietario_id: inactivoId });
    expect(mascotas).toHaveLength(1); // nunca se duplicó
    expect(mascotas[0].id).toBe(mascotaId); // mismo id, no una fila nueva
    expect(mascotas[0].nombre).toBe('Mascota Precargada Editada'); // sí se actualizó
  });

  it('AC21/AC22: tutores.editar sin tutores.crear no puede dar de alta', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);
    // No puede llegar a /tutores/nuevo (falta tutores.crear) para sacar un
    // token propio de ahí — el CSRF es de sesión, no de ruta, así que
    // cualquier página a la que SÍ tenga acceso sirve igual.
    const csrfToken = await getTutoresCsrfToken(agent);

    const res = await agent
      .post('/tutores')
      .set('x-csrf-token', csrfToken)
      .send({
        nombre: `No Debería Crearse ${SUFFIX_156}`,
        telefono: '55-1000-0004',
        pacientes: [],
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const noExiste = await db('propietarios')
      .where('nombre', 'like', '%No Debería Crearse%')
      .first();
    expect(noExiste).toBeUndefined();
  });
});

describe('PUT /tutores/:id (US-156 AC14-AC21 — edición)', () => {
  let tutorId;
  let mascotaId;

  beforeEach(async () => {
    tutorId = await crearTutor({
      nombre: 'Editable',
      apellidos: SUFFIX_156,
      telefono: '55-1000-0010',
      correo: null,
      activo: true,
    });
    mascotaId = await crearMascota(tutorId, {
      nombre: 'Rocky',
      tipo: 'Perro',
      raza: 'Poodle',
      activo: true,
    });
  });

  // El mismo teléfono se reutiliza en cada test de este describe (varios
  // ACs necesitan probar exactamente "editar sin cambiar el teléfono
  // propio") — sin limpiar entre tests, el `beforeEach` de arriba chocaría
  // con el UNIQUE de propietarios.telefono desde el segundo test en
  // adelante (bug real encontrado al escribir esta suite).
  afterEach(async () => {
    await db('mascotas').where({ propietario_id: tutorId }).del();
    await db('propietarios').where({ id: tutorId }).del();
  });

  it('AC15: actualiza los datos del propietario y registra auditoría', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await putTutor(agent, tutorId, {
      nombre: 'Editado',
      apellidos: SUFFIX_156,
      telefono: '55-1000-0010',
      correo: 'editado@correo.test',
      pacientes: [{ id: mascotaId, nombre: 'Rocky', tipo: 'Perro', raza: 'Poodle', activo: true }],
    });

    expect(res.status).toBe(200);
    const row = await db('propietarios').where({ id: tutorId }).first();
    expect(row.nombre).toBe('Editado');
    expect(row.apellidos).toBe(SUFFIX_156);
    expect(row.correo).toBe('editado@correo.test');
    expect(row.actualizado_por).not.toBeNull();
    expect(row.actualizado_en).not.toBeNull();
  });

  it('AC16: modificar los datos de una mascota existente la actualiza sin tocar las demás', async () => {
    const otraMascotaId = await crearMascota(tutorId, {
      nombre: 'Michi',
      tipo: 'Gato',
      raza: 'Persa',
      activo: true,
    });
    const agent = await loginAs(SOLO_EDITAR_USER);

    await putTutor(agent, tutorId, {
      nombre: 'Editable',
      apellidos: SUFFIX_156,
      telefono: '55-1000-0010',
      pacientes: [
        { id: mascotaId, nombre: 'Rocky Editado', tipo: 'Perro', raza: 'Poodle Toy', activo: true },
        { id: otraMascotaId, nombre: 'Michi', tipo: 'Gato', raza: 'Persa', activo: true },
      ],
    });

    const rocky = await db('mascotas').where({ id: mascotaId }).first();
    expect(rocky.nombre).toBe('Rocky Editado');
    expect(rocky.raza).toBe('Poodle Toy');
    expect(rocky.actualizado_por).not.toBeNull();

    const michi = await db('mascotas').where({ id: otraMascotaId }).first();
    expect(michi.nombre).toBe('Michi'); // intacta
  });

  it('AC15: agregar una mascota nueva durante la edición la crea activa y asociada al mismo propietario', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await putTutor(agent, tutorId, {
      nombre: 'Editable',
      apellidos: SUFFIX_156,
      telefono: '55-1000-0010',
      pacientes: [
        { id: mascotaId, nombre: 'Rocky', tipo: 'Perro', raza: 'Poodle', activo: true },
        { nombre: 'Nueva Mascota', tipo: 'Ave', raza: 'Canario' },
      ],
    });

    expect(res.status).toBe(200);
    const nuevas = await db('mascotas').where({ propietario_id: tutorId, nombre: 'Nueva Mascota' });
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0].activo).toBe(true);
    expect(nuevas[0].creado_por).not.toBeNull();
  });

  it('AC17: dar de baja una mascota activa la desactiva sin eliminarla físicamente', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    await putTutor(agent, tutorId, {
      nombre: 'Editable',
      apellidos: SUFFIX_156,
      telefono: '55-1000-0010',
      pacientes: [{ id: mascotaId, nombre: 'Rocky', tipo: 'Perro', raza: 'Poodle', activo: false }],
    });

    const row = await db('mascotas').where({ id: mascotaId }).first();
    expect(row).toBeDefined(); // sigue existiendo, no se borró
    expect(row.activo).toBe(false);
    expect(row.desactivado_por).not.toBeNull();
    expect(row.desactivado_en).not.toBeNull();
  });

  it('AC18/AC19: reactivar una mascota inactiva la vuelve a poner activa, conservando id y propietario_id', async () => {
    await db('mascotas').where({ id: mascotaId }).update({
      activo: false,
      desactivado_por: 1,
      desactivado_en: db.fn.now(),
    });
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await putTutor(agent, tutorId, {
      nombre: 'Editable',
      apellidos: SUFFIX_156,
      telefono: '55-1000-0010',
      pacientes: [{ id: mascotaId, nombre: 'Rocky', tipo: 'Perro', raza: 'Poodle', activo: true }],
    });

    expect(res.status).toBe(200);
    const row = await db('mascotas').where({ id: mascotaId }).first();
    expect(row.id).toBe(mascotaId);
    expect(row.propietario_id).toBe(tutorId);
    expect(row.activo).toBe(true);
    expect(row.desactivado_por).toBeNull();
    expect(row.desactivado_en).toBeNull();
    expect(row.actualizado_por).not.toBeNull();
  });

  it('AC5/AC21 (edición NUNCA reactiva, a diferencia de alta): un teléfono de otro propietario, activo o inactivo, siempre se rechaza', async () => {
    const otroActivoTelefono = '55-1000-0011';
    await crearTutor({
      nombre: 'Otro',
      apellidos: `Activo ${SUFFIX_156}`,
      telefono: otroActivoTelefono,
      correo: null,
      activo: true,
    });
    const otroInactivoTelefono = '55-1000-0012';
    await crearTutor({
      nombre: 'Otro',
      apellidos: `Inactivo ${SUFFIX_156}`,
      telefono: otroInactivoTelefono,
      correo: null,
      activo: false,
    });
    const agent = await loginAs(SOLO_EDITAR_USER);

    const contraActivo = await putTutor(agent, tutorId, {
      nombre: 'Editable',
      apellidos: SUFFIX_156,
      telefono: otroActivoTelefono,
      pacientes: [],
    });
    expect(contraActivo.status).toBe(400);

    const contraInactivo = await putTutor(agent, tutorId, {
      nombre: 'Editable',
      apellidos: SUFFIX_156,
      telefono: otroInactivoTelefono,
      pacientes: [],
    });
    expect(contraInactivo.status).toBe(400);
    expect(contraInactivo.body.requiereConfirmacion).toBeUndefined(); // nunca pide reactivar en edición
  });

  it('AC15: editar sin modificar el propio teléfono no se rechaza como duplicado consigo mismo', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await putTutor(agent, tutorId, {
      nombre: 'Editable',
      apellidos: `Renombrado ${SUFFIX_156}`,
      telefono: '55-1000-0010', // el mismo que ya tenía
      pacientes: [{ id: mascotaId, nombre: 'Rocky', tipo: 'Perro', raza: 'Poodle', activo: true }],
    });

    expect(res.status).toBe(200);
  });

  it('AC21/AC22: tutores.crear sin tutores.editar no puede editar', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    // No puede llegar a /tutores/:id/editar (falta tutores.editar) para
    // sacar un token propio de ahí — mismo motivo que el test análogo de
    // POST /tutores más arriba.
    const csrfToken = await getTutoresCsrfToken(agent);

    const res = await agent.put(`/tutores/${tutorId}`).set('x-csrf-token', csrfToken).send({
      nombre: 'No debería aplicarse',
      telefono: '55-1000-0010',
      pacientes: [],
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const row = await db('propietarios').where({ id: tutorId }).first();
    expect(row.nombre).toBe('Editable'); // sin cambios
    expect(row.apellidos).toBe(SUFFIX_156); // sin cambios
  });
});

describe('POST /tutores/buscar-telefono (pedido del usuario: búsqueda en vivo en el alta)', () => {
  it('con texto encuentra un propietario ACTIVO existente por coincidencia parcial de teléfono', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');

    const res = await agent
      .post('/tutores/buscar-telefono')
      .set('x-csrf-token', csrfToken)
      .send({ q: '5550001001' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: anaId, nombre: 'Ana', apellidos: `García ${SUFFIX}` }),
    ]);
  });

  // Ajustado tras la primera versión (decidido con el usuario): un
  // propietario INACTIVO nunca debe aparecer aquí — mostrarlo ofrecería un
  // atajo directo a su edición que se saltaría el flujo real de
  // reactivación (con confirmación explícita) que ya existe en el
  // guardado del alta.
  it('EXCLUYE propietarios inactivos, aunque el teléfono coincida exacto', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');

    const res = await agent
      .post('/tutores/buscar-telefono')
      .set('x-csrf-token', csrfToken)
      .send({ q: '5550001003' }); // teléfono de Carla Ruiz, inactiva

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // AC (pedido del usuario): "si no tiene nada, salen todos los usuarios" —
  // sin texto, igual devuelve resultados (los primeros, activos).
  it('sin texto, devuelve propietarios activos (búsqueda incremental desde vacío)', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');

    const res = await agent
      .post('/tutores/buscar-telefono')
      .set('x-csrf-token', csrfToken)
      .send({ q: '' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.length).toBeLessThanOrEqual(8);
    // Ningún inactivo (Carla) se cuela en el listado por defecto.
    expect(res.body.some((r) => r.id === carlaId)).toBe(false);
  });

  it('sin coincidencias devuelve un arreglo vacío, no un error', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');

    const res = await agent
      .post('/tutores/buscar-telefono')
      .set('x-csrf-token', csrfToken)
      .send({ q: 'nada-coincide-9999999999' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('requiere tutores.crear (mismo permiso que la página de alta) — el permiso se valida antes que el CSRF', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent
      .post('/tutores/buscar-telefono')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({ q: '5550001001' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /tutores/verificar-telefono (ajuste posterior: chequeo exacto en blur)', () => {
  it('coincide EXACTO con un propietario ACTIVO: solo trae id/nombre (sin correo/pacientes)', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');

    const res = await agent
      .post('/tutores/verificar-telefono')
      .set('x-csrf-token', csrfToken)
      .send({ telefono: '5550001001' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      existe: true,
      activo: true,
      tutor: { id: anaId, nombre: 'Ana', apellidos: `García ${SUFFIX}` },
    });
  });

  // A diferencia de buscar-telefono (que excluye inactivos a propósito),
  // este endpoint SÍ los revela con su información completa — es el nuevo
  // punto de entrada de la reactivación al salir del campo del teléfono.
  it('coincide EXACTO con un propietario INACTIVO: trae correo y todas sus mascotas para precargar el formulario', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');

    const res = await agent
      .post('/tutores/verificar-telefono')
      .set('x-csrf-token', csrfToken)
      .send({ telefono: '5550001003' }); // teléfono de Carla Ruiz, inactiva

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      existe: true,
      activo: false,
      tutor: {
        id: carlaId,
        nombre: 'Carla',
        apellidos: `Ruiz ${SUFFIX}`,
        telefono: '55-5000-1003', // formatTelefono() de '5550001003' — solo look and feel
        correo: null,
        pacientes: [expect.objectContaining({ nombre: `Rocky ${SUFFIX}`, activo: true })],
      },
    });
  });

  it('sin coincidencia, devuelve existe:false', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);
    const csrfToken = await getTutorFormCsrfToken(agent, '/tutores/nuevo');

    const res = await agent
      .post('/tutores/verificar-telefono')
      .set('x-csrf-token', csrfToken)
      .send({ telefono: 'nada-coincide-9999999999' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ existe: false });
  });

  it('requiere tutores.crear (mismo permiso que buscar-telefono)', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent
      .post('/tutores/verificar-telefono')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({ telefono: '5550001001' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('sin token CSRF es rechazado', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await agent.post('/tutores/verificar-telefono').send({ telefono: '5550001001' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /tutores/:id (US-157 — baja lógica)', () => {
  let tutorBajaId;
  let tutorBajadoId;

  // Dos propietarios que comparten substring de búsqueda ("Baja") — mismo
  // motivo que el test análogo de doctores.test.js: HTMX manda los valores
  // incluidos vía hx-include como QUERY STRING en un DELETE
  // (`methodsThatUseUrlParams` trae "delete" por default, igual que "get"),
  // no como body — un test que solo mandara el body no detectaría ese bug.
  beforeAll(async () => {
    tutorBajaId = await crearTutor({
      nombre: 'Baja',
      apellidos: `Tutor ${SUFFIX_156}`,
      telefono: '55-1000-0020',
      correo: null,
      activo: true,
    });
    tutorBajadoId = await crearTutor({
      nombre: 'Baja',
      apellidos: `Tutor Activo ${SUFFIX_156}`,
      telefono: '55-1000-0021',
      correo: null,
      activo: true,
    });
  });

  // Los tests de este describe dependen del orden (Jest corre los `it` de
  // un mismo archivo en orden, sin paralelizar): el primero desactiva al
  // tutor, el segundo confirma que sigue existiendo con estadoTutores=todos
  // — exactamente el flujo AC5/AC8/AC9 de la historia, no dos casos
  // aislados.
  it('AC5/AC6/AC7: desactiva (activo=false, desactivado_por/desactivado_en), sin DELETE físico, cascada a sus mascotas activas (ajuste posterior pedido por el usuario) sin tocar una mascota ya inactiva de antes, y el fragmento respeta el filtro/búsqueda activos (bug real: HTMX manda estos valores por query string, no por body)', async () => {
    const mascotaId = await crearMascota(tutorBajaId, {
      nombre: 'Firulais Baja',
      tipo: 'Perro',
      raza: 'Labrador',
      activo: true,
    });
    const [{ id: mascotaYaInactivaId }] = await db('mascotas')
      .insert({
        propietario_id: tutorBajaId,
        nombre: 'Michi Ya Inactiva',
        tipo: 'Gato',
        raza: 'Siamés',
        activo: false,
        desactivado_por: null,
        desactivado_en: null,
        creado_en: db.fn.now(),
      })
      .returning('id');
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getTutoresCsrfToken(agent);

    const res = await agent
      .delete(`/tutores/${tutorBajaId}`)
      .query({ estadoTutores: 'activos', q: 'Baja Tutor' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`Baja Tutor ${SUFFIX_156}`); // recién desactivado, ya no aparece
    expect(res.text).toContain(`Baja Tutor Activo ${SUFFIX_156}`); // el otro match de "Baja Tutor" sigue activo
    // "1 resultados" es el assert que realmente distingue el bug: si el
    // fragmento hubiera vuelto al estado por defecto (req.body vacío en vez
    // de req.query), aparecerían TODOS los demás tutores activos de la
    // base (más de 1), no solo el que matchea q="Baja Tutor".
    expect(res.text).toContain('1 resultados');

    const row = await db('propietarios').where({ id: tutorBajaId }).first();
    expect(row.activo).toBe(false);
    expect(row.desactivado_por).not.toBeNull();
    expect(row.desactivado_en).not.toBeNull();

    // Ajuste posterior (pedido por el usuario): la baja del propietario SÍ
    // cascada a sus mascotas activas.
    const mascota = await db('mascotas').where({ id: mascotaId }).first();
    expect(mascota.activo).toBe(false);
    expect(mascota.desactivado_por).not.toBeNull();
    expect(mascota.desactivado_en).not.toBeNull();

    // Una mascota que YA estaba inactiva de antes no se toca: conserva su
    // propio desactivado_por/desactivado_en (aquí null porque se insertó
    // directo por SQL), no se le pisa con la auditoría de esta baja.
    const mascotaYaInactiva = await db('mascotas').where({ id: mascotaYaInactivaId }).first();
    expect(mascotaYaInactiva.activo).toBe(false);
    expect(mascotaYaInactiva.desactivado_por).toBeNull();
    expect(mascotaYaInactiva.desactivado_en).toBeNull();
  });

  it('AC8/AC9/AC13: el registro sigue existiendo (no fue un DELETE físico), aparece con estadoTutores=todos como Inactivo y conserva sus pacientes (ahora inactivos por la cascada, visibles con estadoPacientes=todos)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, {
      q: 'Baja Tutor',
      estadoTutores: 'todos',
      estadoPacientes: 'todos',
    });

    expect(res.text).toContain(`Baja Tutor ${SUFFIX_156}`);
    expect(res.text).toContain('Inactivo');
    expect(res.text).toContain('Firulais Baja');
  });

  it('AC10: un tutor inactivo ya no muestra la acción "Dar de baja"', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarTutores(agent, { q: 'Baja Tutor', estadoTutores: 'todos' });

    // La fila de "Baja Tutor" (inactivo) no debe traer row-action-delete;
    // se verifica contando: con "Baja Tutor Activo" (activo) también en
    // pantalla, debe haber exactamente 1 ícono de eliminar, no 2.
    const matches = res.text.match(/row-action-delete/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.delete(`/tutores/${tutorBajadoId}`).query({ estadoTutores: 'todos' });

    expect(res.status).toBe(403);
  });

  it('AC2/AC16: un usuario sin tutores.eliminar es rebotado a /main.html, aunque intente la baja directo al servidor', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER); // tiene tutores.editar, no tutores.eliminar
    const csrfToken = await getTutoresCsrfToken(agent);

    const res = await agent
      .delete(`/tutores/${tutorBajadoId}`)
      .query({ estadoTutores: 'todos' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const row = await db('propietarios').where({ id: tutorBajadoId }).first();
    expect(row.activo).toBe(true); // sin cambios
  });

  it('un id inválido no truena, responde 200 sin tronar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getTutoresCsrfToken(agent);

    const res = await agent
      .delete('/tutores/no-es-un-id')
      .query({ estadoTutores: 'todos' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
  });
});
