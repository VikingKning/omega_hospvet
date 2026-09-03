// US-612: catálogo de plantillas de WhatsApp — mismo patrón que
// doctores.test.js/areas.test.js (tabla estándar del sistema). Requiere una
// base de datos real migrada y sembrada (ver tests/integration/auth.test.js
// para el porqué). Solo lectura por ahora: alta/edición llegan en US-613, la
// baja real en una historia futura todavía sin número (ver
// plantillas_whatsapp.routes.js).
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SOLO_VER_USER = { username: 'solo.ver.plantillas.test', password: 'SoloVerTest123!' };
const SIN_PERMISOS_USER = {
  username: 'sin.permisos.plantillas.test',
  password: 'SinPermisosTest123!',
};
// US-613: usuarios con exactamente uno de los dos permisos de escritura,
// para probar el AC "editar sin crear (o viceversa) se rechaza, aunque el
// formulario sea el mismo".
const SOLO_CREAR_USER = { username: 'solo.crear.plantillas.test', password: 'SoloCrearTest123!' };
const SOLO_EDITAR_USER = {
  username: 'solo.editar.plantillas.test',
  password: 'SoloEditarTest123!',
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
// login) — hay que leerlo de una carga de /plantillas.html ya autenticada.
async function getPlantillasCsrfToken(agent) {
  const res = await agent.get('/plantillas.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

// HTMX manda el <form> con la codificación por defecto de un form HTML
// (application/x-www-form-urlencoded), no JSON.
async function filtrarPlantillas(agent, body) {
  const csrfToken = await getPlantillasCsrfToken(agent);
  return agent.post('/plantillas.html').type('form').set('x-csrf-token', csrfToken).send(body);
}

const SUFFIX = 'QA612';
async function cleanup() {
  await db('plantillas_whatsapp').where('intencion', 'like', `%${SUFFIX}`).del();

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
      apellidos: 'US612',
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
  await createTestUser(SOLO_VER_USER, ['plantillas.ver']);
  await createTestUser(SIN_PERMISOS_USER, []);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /plantillas.html', () => {
  beforeAll(async () => {
    await db('plantillas_whatsapp').insert({
      intencion: `Confirmar cita ${SUFFIX}`,
      slug: `confirmar-cita-${SUFFIX.toLowerCase()}`,
      texto_respuesta: 'Tu cita ha sido confirmada.',
      activo: true,
      veces_usada: 12,
      aprobado_meta: true,
      creado_en: db.fn.now(),
    });
    await db('plantillas_whatsapp').insert({
      intencion: `Recordatorio vacuna ${SUFFIX}`,
      slug: `recordatorio-vacuna-${SUFFIX.toLowerCase()}`,
      texto_respuesta: 'Te recordamos la vacuna de tu mascota.',
      activo: true,
      veces_usada: 3,
      creado_en: db.fn.now(),
    });
    await db('plantillas_whatsapp').insert({
      intencion: `Retirada ${SUFFIX}`,
      slug: `retirada-${SUFFIX.toLowerCase()}`,
      texto_respuesta: 'Texto de una plantilla dada de baja.',
      activo: false,
      veces_usada: 0,
      creado_en: db.fn.now(),
    });
  });

  it('AC: la carga inicial tiene "Activos" seleccionado por defecto y solo lista activas (cambio explícito del usuario, 2026-09-03), con intención/slug/estado en Meta/estado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/plantillas.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Confirmar cita ${SUFFIX}`);
    expect(res.text).not.toContain(`Retirada ${SUFFIX}`); // inactiva, ya NO aparece por defecto
    expect(res.text).toContain('toggle-btn active'); // el toggle "Activos" trae la clase active por defecto
    expect(res.text).toContain(`confirmar-cita-${SUFFIX.toLowerCase()}`); // columna Slug (LLM)
    expect(res.text).toContain('Estado en Meta');
    expect(res.text).not.toContain('Veces usada'); // se movió al detalle (ícono Ver), ya no es columna de la tabla
    expect(res.text).toContain('Aprobado'); // Confirmar cita, aprobado_meta=true
    expect(res.text).toContain('En revisión'); // Recordatorio vacuna (activa, aprobado_meta=false) — mismo texto que usa Meta
  });

  it('AC: con el filtro Todos, una plantilla inactiva muestra "N/A" en Estado en Meta, no "En revisión" (nunca se manda mientras esté inactiva)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { estado: 'todos' });
    const inicioFila = res.text.indexOf(`<td>Retirada ${SUFFIX}</td>`);
    const filaRetirada = res.text.slice(inicioFila).split('</tr>')[0];

    expect(filaRetirada).toContain('N/A');
    expect(filaRetirada).not.toContain('En revisión');
  });

  it('un GET con query string a mano se ignora por completo (privacidad: nunca se lee ni se refleja)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/plantillas.html?estado=todos&q=${SUFFIX}`);

    // Si leyera estado=todos de la URL, Retirada (inactiva) aparecería —
    // como se ignora, sigue aplicando el default (activos) y no aparece.
    expect(res.text).not.toContain(`Retirada ${SUFFIX}`);
  });

  it('POST con estado=activos EXCLUYE a las inactivas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { estado: 'activos' });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`Retirada ${SUFFIX}`);
    expect(res.text).toContain(`Confirmar cita ${SUFFIX}`);
  });

  it('POST con q=recordatorio encuentra la plantilla por intención', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { q: 'Recordatorio' });

    expect(res.text).toContain(`Recordatorio vacuna ${SUFFIX}`);
    expect(res.text).not.toContain(`Confirmar cita ${SUFFIX}`);
  });

  it('POST con q=recordatorio-vacuna (el slug) también encuentra la plantilla', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { q: 'recordatorio-vacuna' });

    expect(res.text).toContain(`Recordatorio vacuna ${SUFFIX}`);
    expect(res.text).not.toContain(`Confirmar cita ${SUFFIX}`);
  });

  it('POST sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.post('/plantillas.html').send({ estado: 'activos' });

    expect(res.status).toBe(403);
  });

  it('AC: un usuario con solo plantillas.ver no ve los botones de crear/editar/eliminar', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/plantillas.html');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Nueva Plantilla');
    expect(res.text).not.toContain('row-action-edit');
    expect(res.text).not.toContain('row-action-delete');
  });

  it('AC: el ícono de editar aparece en TODAS las filas (activas e inactivas) con plantillas.editar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { estado: 'todos' });
    const filas = res.text.split('row-action-edit').length - 1;

    expect(filas).toBeGreaterThanOrEqual(3); // las 3 fixtures de este archivo, activas e inactivas
  });

  it('AC: el ícono de eliminar NO aparece en una plantilla inactiva, aunque haya permiso', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { estado: 'todos' });
    // Ancla en la celda <td> exacta, no en el texto suelto de la intención
    // (que también se repite en el aria-label del ícono Ver de esta misma
    // fila) — mismo ajuste que el test de "Baja" más abajo.
    const inicioFila = res.text.indexOf(`<td>Retirada ${SUFFIX}</td>`);
    const filaRetirada = res.text.slice(inicioFila).split('</tr>')[0];

    expect(filaRetirada).not.toContain('row-action-delete');
  });

  it('un usuario sin plantillas.ver es rebotado a /main.html al pedir /plantillas.html directo', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/plantillas.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin plantillas.ver recibe HX-Redirect (no un 302 normal) cuando la petición viene de HTMX', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent.post('/login').set('x-csrf-token', csrfToken).send(SIN_PERMISOS_USER);

    const res = await agent
      .post('/plantillas.html')
      .set('HX-Request', 'true')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({ estado: 'todos' });

    expect(res.status).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/main.html');
  });

  describe('orden de la tabla por header (POST sort=&dir=)', () => {
    it('sort=intencion&dir=asc (por defecto) ordena alfabéticamente', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarPlantillas(agent, {
        estado: 'todos',
        sort: 'intencion',
        dir: 'asc',
      });

      const idxConfirmar = res.text.indexOf(`Confirmar cita ${SUFFIX}`);
      const idxRecordatorio = res.text.indexOf(`Recordatorio vacuna ${SUFFIX}`);
      const idxRetirada = res.text.indexOf(`Retirada ${SUFFIX}`);
      expect(idxConfirmar).toBeLessThan(idxRecordatorio);
      expect(idxRecordatorio).toBeLessThan(idxRetirada);
    });

    it('sort=intencion&dir=desc invierte el orden', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarPlantillas(agent, {
        estado: 'todos',
        sort: 'intencion',
        dir: 'desc',
      });

      const idxConfirmar = res.text.indexOf(`Confirmar cita ${SUFFIX}`);
      const idxRetirada = res.text.indexOf(`Retirada ${SUFFIX}`);
      expect(idxRetirada).toBeLessThan(idxConfirmar);
    });

    it('sort=slug ordena por slug', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarPlantillas(agent, { estado: 'todos', sort: 'slug', dir: 'asc' });

      const idxConfirmar = res.text.indexOf(`confirmar-cita-${SUFFIX.toLowerCase()}`);
      const idxRecordatorio = res.text.indexOf(`recordatorio-vacuna-${SUFFIX.toLowerCase()}`);
      const idxRetirada = res.text.indexOf(`retirada-${SUFFIX.toLowerCase()}`);
      expect(idxConfirmar).toBeLessThan(idxRecordatorio);
      expect(idxRecordatorio).toBeLessThan(idxRetirada);
    });

    it('sort=estado_meta agrupa pendientes/aprobadas respetando la dirección', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarPlantillas(agent, {
        estado: 'todos',
        sort: 'estado_meta',
        dir: 'asc',
      });

      const idxRecordatorio = res.text.indexOf(`Recordatorio vacuna ${SUFFIX}`); // aprobado_meta=false
      const idxConfirmar = res.text.indexOf(`Confirmar cita ${SUFFIX}`); // aprobado_meta=true
      expect(idxRecordatorio).toBeLessThan(idxConfirmar); // pendiente (false) antes que aprobada (true) en asc
    });

    it('sort=estado agrupa por activa/inactiva respetando la dirección', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const asc = await filtrarPlantillas(agent, { estado: 'todos', sort: 'estado', dir: 'asc' });

      expect(asc.text.indexOf(`Retirada ${SUFFIX}`)).toBeLessThan(
        asc.text.indexOf(`Confirmar cita ${SUFFIX}`),
      );
    });

    it('una columna de orden desconocida no truena, cae al orden por intención', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarPlantillas(agent, { estado: 'todos', sort: 'algo-invalido' });

      expect(res.status).toBe(200);
      expect(res.text).toContain(`Confirmar cita ${SUFFIX}`);
    });
  });
});

describe('GET /plantillas/nuevo, /:id/editar y /:id/ver (US-613 — formulario, y el ícono Ver)', () => {
  let plantillaId;

  beforeAll(async () => {
    await createTestUser(SOLO_CREAR_USER, ['plantillas.ver', 'plantillas.crear']);
    await createTestUser(SOLO_EDITAR_USER, ['plantillas.ver', 'plantillas.editar']);

    const [plantilla] = await db('plantillas_whatsapp')
      .insert({
        intencion: `Formulario ${SUFFIX}`,
        slug: `formulario-${SUFFIX.toLowerCase()}`,
        texto_respuesta: 'Texto original de la plantilla.',
        activo: true,
        veces_usada: 0,
        creado_en: db.fn.now(),
      })
      .returning('id');
    plantillaId = plantilla.id;
  });

  it('AC: el formulario de alta abre vacío, con título "Nueva plantilla"', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/plantillas/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nueva plantilla');
    expect(res.text).not.toContain('Editar plantilla');
  });

  it('AC: el formulario de edición trae intención/slug/texto_respuesta precargados, título "Editar plantilla", con intención y slug de solo lectura', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/plantillas/${plantillaId}/editar`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Editar plantilla');
    expect(res.text).toContain(`value="Formulario ${SUFFIX}"`);
    expect(res.text).toContain('Texto original de la plantilla.');
    const plantilla = await db('plantillas_whatsapp').where({ id: plantillaId }).first();
    expect(res.text).toContain(`value="${plantilla.slug}"`);
    expect(res.text).toContain('readonly');
    // "intencion" ya no viaja como campo editable — no hay <input name="intencion"> en edición.
    expect(res.text).not.toContain('name="intencion"');
  });

  it('un usuario sin plantillas.crear no puede abrir el formulario de alta', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent.get('/plantillas/nuevo');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin plantillas.editar no puede abrir el formulario de edición', async () => {
    const agent = await loginAs(SOLO_CREAR_USER);

    const res = await agent.get(`/plantillas/${plantillaId}/editar`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('AC: el detalle de solo lectura (Ver) trae intención/slug/texto_respuesta/veces_usada/estado/estado en Meta', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/plantillas/${plantillaId}/ver`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Detalle de la plantilla');
    expect(res.text).toContain(`value="Formulario ${SUFFIX}"`);
    expect(res.text).toContain('Texto original de la plantilla.');
    expect(res.text).toContain('value="0"'); // veces_usada
    expect(res.text).toContain('value="En revisión"'); // aprobado_meta=false por default
  });

  it('un usuario con solo plantillas.ver SÍ puede abrir el detalle (a diferencia de editar, que exige plantillas.editar)', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get(`/plantillas/${plantillaId}/ver`);

    expect(res.status).toBe(200);
  });

  it('un usuario sin ningún permiso no puede abrir el detalle', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get(`/plantillas/${plantillaId}/ver`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un id inexistente responde 404', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/plantillas/999999999/ver');

    expect(res.status).toBe(404);
  });
});

describe('POST /plantillas y PUT /plantillas/:id (US-613 — alta y edición)', () => {
  async function crearPlantilla(agent, intencion, texto = 'Texto de respuesta de prueba.') {
    const csrfToken = await getPlantillasCsrfToken(agent);
    return agent
      .post('/plantillas')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ intencion, texto_respuesta: texto });
  }

  // Sin `intencion`: el formulario real ya no la manda en edición (campo
  // de solo lectura, sin `name`, ver plantilla-form.ejs) — este helper
  // replica ese comportamiento. activo:'true' por defecto — el switch
  // Activo/Inactivo solo viaja en el body cuando está marcado, así que sin
  // este default cada edición de estos tests desactivaría la plantilla
  // como efecto secundario no buscado (ver los tests dedicados al switch
  // más abajo).
  async function editarPlantilla(agent, id, texto = 'Texto editado.', activo = 'true') {
    const csrfToken = await getPlantillasCsrfToken(agent);
    return agent
      .put(`/plantillas/${id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ texto_respuesta: texto, activo });
  }

  it('AC: alta sin id inserta la plantilla con activo=true, veces_usada=0 y hace el swap out-of-band de la tabla', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await crearPlantilla(agent, `Nueva Alta ${SUFFIX}`, 'Respuesta de alta.');

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closePlantillaModal');
    expect(res.text).toContain('hx-swap-oob="true"');

    const row = await db('plantillas_whatsapp').where('intencion', `Nueva Alta ${SUFFIX}`).first();
    expect(row).toBeDefined();
    expect(row.texto_respuesta).toBe('Respuesta de alta.');
    expect(row.activo).toBe(true);
    expect(row.veces_usada).toBe(0);
    expect(row.creado_por).not.toBeNull();
    expect(row.slug).toBeTruthy(); // generado automáticamente a partir de la intención
  });

  it('AC: el slug se genera a partir de la intención, sin acentos y en minúsculas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    await crearPlantilla(agent, `Cambio de Horario ${SUFFIX}`, 'Respuesta.');

    const row = await db('plantillas_whatsapp')
      .where('intencion', `Cambio de Horario ${SUFFIX}`)
      .first();
    expect(row.slug).toBe(`cambio-de-horario-${SUFFIX.toLowerCase()}`);
  });

  it('AC: una intención vacía muestra el error y no cierra el modal ni crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await crearPlantilla(agent, '   ');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Intención es obligatorio');
    expect(res.headers['hx-trigger']).toBeUndefined();
    expect(res.text).not.toContain('hx-swap-oob');
  });

  it('AC: un texto de respuesta vacío muestra el error y no crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getPlantillasCsrfToken(agent);

    const res = await agent
      .post('/plantillas')
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ intencion: `SinTexto ${SUFFIX}`, texto_respuesta: '   ' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Texto de respuesta es obligatorio');

    const row = await db('plantillas_whatsapp').where('intencion', `SinTexto ${SUFFIX}`).first();
    expect(row).toBeUndefined();
  });

  it('AC: una intención duplicada con una plantilla activa muestra el error y no cierra el modal ni crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const intencion = `Duplicada ${SUFFIX}`;
    await crearPlantilla(agent, intencion); // primera, debe quedar activa

    const res = await crearPlantilla(agent, intencion); // segunda con la misma intención

    expect(res.status).toBe(200);
    expect(res.text).toContain('La intención ya está registrada.');
    expect(res.headers['hx-trigger']).toBeUndefined();
    expect(res.text).not.toContain('hx-swap-oob');

    const count = await db('plantillas_whatsapp')
      .where('intencion', intencion)
      .count('* as total')
      .first();
    expect(Number(count.total)).toBe(1);
  });

  it('AC: la edición actualiza texto_respuesta y conserva veces_usada', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    await crearPlantilla(agent, `Original ${SUFFIX}`);
    const original = await db('plantillas_whatsapp')
      .where('intencion', `Original ${SUFFIX}`)
      .first();
    await db('plantillas_whatsapp').where({ id: original.id }).update({ veces_usada: 42 });

    const res = await editarPlantilla(agent, original.id, 'Texto nuevo.');

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closePlantillaModal');

    const actualizada = await db('plantillas_whatsapp').where({ id: original.id }).first();
    expect(actualizada.texto_respuesta).toBe('Texto nuevo.');
    expect(actualizada.veces_usada).toBe(42); // no se tocó
    expect(actualizada.actualizado_por).not.toBeNull();
    expect(actualizada.actualizado_en).not.toBeNull();
  });

  it('AC: la intención y el slug son inmutables — aunque se manden distintos en el body del PUT, se ignoran por completo', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    await crearPlantilla(agent, `Inmutable ${SUFFIX}`);
    const original = await db('plantillas_whatsapp')
      .where('intencion', `Inmutable ${SUFFIX}`)
      .first();
    const csrfToken = await getPlantillasCsrfToken(agent);

    // Ataque directo al endpoint (no vía el formulario, que ni siquiera
    // manda este campo en edición): confirma que el backend lo ignora, no
    // solo que la UI no lo ofrece.
    const res = await agent
      .put(`/plantillas/${original.id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({
        intencion: `Otra Cosa Totalmente Distinta ${SUFFIX}`,
        slug: 'otro-slug-cualquiera',
        texto_respuesta: 'Texto que sí debe guardarse.',
        activo: 'true',
      });

    expect(res.status).toBe(200);
    const actualizada = await db('plantillas_whatsapp').where({ id: original.id }).first();
    expect(actualizada.intencion).toBe(`Inmutable ${SUFFIX}`); // sin cambios
    expect(actualizada.slug).toBe(original.slug); // sin cambios
    expect(actualizada.texto_respuesta).toBe('Texto que sí debe guardarse.'); // esto sí se actualiza
  });

  it('AC (switch, a petición del usuario): desmarcar "Activo" al editar desactiva la plantilla (desactivado_por/desactivado_en)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const intencion = `DesactivarPorSwitch ${SUFFIX}`;
    await crearPlantilla(agent, intencion);
    const plantilla = await db('plantillas_whatsapp').where({ intencion }).first();

    const res = await editarPlantilla(agent, plantilla.id, 'Texto.', 'false');

    expect(res.status).toBe(200);
    const actualizada = await db('plantillas_whatsapp').where({ id: plantilla.id }).first();
    expect(actualizada.activo).toBe(false);
    expect(actualizada.desactivado_por).not.toBeNull();
    expect(actualizada.desactivado_en).not.toBeNull();
  });

  it('AC (switch, a petición del usuario): marcar "Activo" al editar REACTIVA una plantilla inactiva (limpia desactivado_por/desactivado_en)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const intencion = `ReactivarPorSwitch ${SUFFIX}`;
    await crearPlantilla(agent, intencion);
    const plantilla = await db('plantillas_whatsapp').where({ intencion }).first();
    await editarPlantilla(agent, plantilla.id, 'Texto.', 'false');
    const inactiva = await db('plantillas_whatsapp').where({ id: plantilla.id }).first();
    expect(inactiva.activo).toBe(false);

    const res = await editarPlantilla(agent, plantilla.id, 'Texto.', 'true');

    expect(res.status).toBe(200);
    const actualizada = await db('plantillas_whatsapp').where({ id: plantilla.id }).first();
    expect(actualizada.activo).toBe(true);
    expect(actualizada.desactivado_por).toBeNull();
    expect(actualizada.desactivado_en).toBeNull();
  });

  it('AC: el formulario de edición trae el switch marcado para una plantilla activa', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const intencion = `SwitchPrecargado ${SUFFIX}`;
    await crearPlantilla(agent, intencion);
    const plantilla = await db('plantillas_whatsapp').where({ intencion }).first();

    const res = await agent.get(`/plantillas/${plantilla.id}/editar`);

    expect(res.text).toContain('name="activo" value="true" checked');
  });

  it('AC: editar solo el texto (sin tocar intención) siempre tiene éxito, sin chequeo de duplicados', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const intencion = `SinCambios ${SUFFIX}`;
    await crearPlantilla(agent, intencion);
    const plantilla = await db('plantillas_whatsapp').where({ intencion }).first();

    const res = await editarPlantilla(agent, plantilla.id, 'Texto nuevo.');

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closePlantillaModal');
  });

  it('POST /plantillas sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent
      .post('/plantillas')
      .type('form')
      .send({ intencion: `SinCsrf ${SUFFIX}`, texto_respuesta: 'algo' });

    expect(res.status).toBe(403);
  });

  it('AC: un usuario con plantillas.editar pero SIN plantillas.crear no puede dar de alta, aunque el formulario sea el mismo', async () => {
    const agent = await loginAs(SOLO_EDITAR_USER);

    const res = await agent
      .post('/plantillas')
      .type('form')
      .send({ intencion: `SinPermisoCrear ${SUFFIX}`, texto_respuesta: 'algo' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const row = await db('plantillas_whatsapp')
      .where('intencion', `SinPermisoCrear ${SUFFIX}`)
      .first();
    expect(row).toBeUndefined();
  });

  it('AC: un usuario con plantillas.crear pero SIN plantillas.editar no puede editar, aunque el formulario sea el mismo', async () => {
    const adminAgent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const intencion = `SinPermisoEditar ${SUFFIX}`;
    await crearPlantilla(adminAgent, intencion);
    const plantilla = await db('plantillas_whatsapp').where({ intencion }).first();

    const agent = await loginAs(SOLO_CREAR_USER);
    const res = await agent
      .put(`/plantillas/${plantilla.id}`)
      .type('form')
      .send({ intencion: 'Lo que sea', texto_respuesta: 'algo' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const sinCambios = await db('plantillas_whatsapp').where({ id: plantilla.id }).first();
    expect(sinCambios.intencion).toBe(intencion);
  });
});

describe('DELETE /plantillas/:id (US-614 — baja lógica)', () => {
  let plantillaId;
  let plantillaId2;

  // Dos plantillas que comparten substring de búsqueda ("Baja") — necesario
  // para el test de abajo que reproduce el gotcha ya conocido de
  // doctores/áreas: HTMX manda los valores incluidos vía hx-include como
  // QUERY STRING en un DELETE (`methodsThatUseUrlParams` trae "delete" por
  // default, igual que "get"), no como body.
  beforeAll(async () => {
    const [plantilla] = await db('plantillas_whatsapp')
      .insert({
        intencion: `Baja ${SUFFIX}`,
        slug: `baja-${SUFFIX.toLowerCase()}`,
        texto_respuesta: 'Texto de la plantilla a dar de baja.',
        activo: true,
        veces_usada: 5,
        creado_en: db.fn.now(),
      })
      .returning('id');
    plantillaId = plantilla.id;

    const [plantilla2] = await db('plantillas_whatsapp')
      .insert({
        intencion: `Bajado ${SUFFIX}`,
        slug: `bajado-${SUFFIX.toLowerCase()}`,
        texto_respuesta: 'Otra plantilla.',
        activo: true,
        veces_usada: 0,
        creado_en: db.fn.now(),
      })
      .returning('id');
    plantillaId2 = plantilla2.id;
  });

  // Los tests de este describe dependen del orden (Jest corre los `it` de un
  // mismo archivo en orden, sin paralelizar): el primero desactiva la
  // plantilla, el siguiente confirma que sigue existiendo con estado=todos.
  it('AC: desactiva (activo=false, desactivado_por/desactivado_en), conserva veces_usada, sin DELETE físico, y el fragmento respeta el filtro/búsqueda activos (bug real: HTMX manda estos valores por query string, no por body)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getPlantillasCsrfToken(agent);

    const res = await agent
      .delete(`/plantillas/${plantillaId}`)
      .query({ estado: 'activos', q: 'Baja' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`Baja ${SUFFIX}`); // recién desactivada, ya no aparece
    expect(res.text).toContain(`Bajado ${SUFFIX}`); // el otro match de "Baja" sigue activo
    // "1 resultados" es el assert que realmente distingue el bug: si el
    // fragmento hubiera vuelto al estado por defecto (req.body vacío en vez
    // de req.query), aparecerían TODAS las demás plantillas activas de la
    // base, no solo la que matchea q=Baja.
    expect(res.text).toContain('1 resultados');

    const row = await db('plantillas_whatsapp').where({ id: plantillaId }).first();
    expect(row.activo).toBe(false);
    expect(row.desactivado_por).not.toBeNull();
    expect(row.desactivado_en).not.toBeNull();
    expect(row.veces_usada).toBe(5); // no se tocó
  });

  it('AC: con el filtro Activos seleccionado la plantilla dada de baja no aparece', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { estado: 'activos' });

    expect(res.text).not.toContain(`Baja ${SUFFIX}`);
  });

  it('AC: con el filtro Todos, la plantilla sigue existiendo (no fue un DELETE físico) y aparece como Inactiva', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { estado: 'todos' });

    expect(res.text).toContain(`Baja ${SUFFIX}`);
    expect(res.text).toContain('Inactivo');
  });

  it('AC: con Todos seleccionado, una plantilla inactiva sigue mostrando la opción de Editar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarPlantillas(agent, { estado: 'todos' });
    // Ancla en la celda <td> exacta (no en el texto de la intención suelto):
    // desde el ícono "Ver" el texto de la intención también aparece en su
    // aria-label dentro de la misma fila, así que un split ingenuo sobre
    // "Baja QA612" corta en la primera repetición (el propio aria-label del
    // ícono Ver), no al final de la fila.
    const inicioFila = res.text.indexOf(`<td>Baja ${SUFFIX}</td>`);
    const filaBaja = res.text.slice(inicioFila).split('</tr>')[0];

    expect(filaBaja).toContain('row-action-edit');
  });

  it('AC: reactivar mediante US-613 (switch del formulario de edición) conserva el valor histórico de veces_usada', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getPlantillasCsrfToken(agent);

    const editRes = await agent
      .put(`/plantillas/${plantillaId}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ intencion: `Baja ${SUFFIX}`, texto_respuesta: 'Texto reactivado.', activo: 'true' });

    expect(editRes.status).toBe(200);
    expect(editRes.headers['hx-trigger']).toBe('closePlantillaModal');

    const row = await db('plantillas_whatsapp').where({ id: plantillaId }).first();
    expect(row.activo).toBe(true);
    expect(row.desactivado_por).toBeNull();
    expect(row.desactivado_en).toBeNull();
    expect(row.veces_usada).toBe(5); // se conserva, no se resetea al reactivar

    // Y el listado con Activos vuelve a mostrarla — "actualiza la tabla"
    // tras la reactivación, mismo criterio que la baja.
    const listado = await filtrarPlantillas(agent, { estado: 'activos' });
    expect(listado.text).toContain(`Baja ${SUFFIX}`);
  });

  it('sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.delete(`/plantillas/${plantillaId2}`).query({ estado: 'todos' });

    expect(res.status).toBe(403);
  });

  it('AC: un usuario con plantillas.ver pero sin plantillas.eliminar es rebotado a /main.html (aunque se invoque directo, fuera de la interfaz)', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.delete(`/plantillas/${plantillaId2}`).query({ estado: 'todos' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');

    const sinCambios = await db('plantillas_whatsapp').where({ id: plantillaId2 }).first();
    expect(sinCambios.activo).toBe(true); // no se tocó
  });

  it('un id inválido no truena, responde 200 sin tronar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getPlantillasCsrfToken(agent);

    const res = await agent
      .delete('/plantillas/no-es-un-id')
      .query({ estado: 'todos' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
  });
});

// Migración 20260903000002 — 4 plantillas del sistema (emergencia_medica,
// agendar_cita_default, resultados_laboratorio_default,
// sin_coincidencia_default), sembradas una sola vez para toda la BD, no
// por SUFFIX como las demás fixtures de este archivo — por eso cleanup()
// nunca las toca (no matchean `intencion LIKE '%QA612'`) y estos tests
// solo LEEN/prueban acciones reversibles sobre ellas, nunca las dan de
// baja de verdad.
describe('Plantillas predeterminadas del sistema (es_predeterminada) — inborrables, solo editables', () => {
  let predeterminada;

  beforeAll(async () => {
    predeterminada = await db('plantillas_whatsapp').where({ slug: 'emergencia-medica' }).first();
  });

  it('AC: no se puede eliminar — responde 400 y la fila queda intacta', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getPlantillasCsrfToken(agent);

    const res = await agent
      .delete(`/plantillas/${predeterminada.id}`)
      .query({ estado: 'todos' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(400);

    const row = await db('plantillas_whatsapp').where({ id: predeterminada.id }).first();
    expect(row.activo).toBe(true);
    expect(row.desactivado_por).toBeNull();
  });

  it('AC: el ícono de eliminar no aparece en la tabla para una plantilla predeterminada, aunque esté activa y haya permiso', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/plantillas.html');
    const inicioFila = res.text.indexOf(`<td>${predeterminada.intencion} `);
    const fila = res.text.slice(inicioFila).split('</tr>')[0];

    expect(fila).toContain('Predeterminada');
    expect(fila).not.toContain('row-action-delete');
  });

  it('AC: editar el texto SÍ funciona (es lo único editable)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getPlantillasCsrfToken(agent);

    const res = await agent
      .put(`/plantillas/${predeterminada.id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ texto_respuesta: 'Texto de emergencia actualizado en la prueba.', activo: 'true' });

    expect(res.status).toBe(200);
    const row = await db('plantillas_whatsapp').where({ id: predeterminada.id }).first();
    expect(row.texto_respuesta).toBe('Texto de emergencia actualizado en la prueba.');

    // Deja el texto como estaba, para no afectar otras corridas de este archivo.
    await db('plantillas_whatsapp')
      .where({ id: predeterminada.id })
      .update({ texto_respuesta: predeterminada.texto_respuesta });
  });

  it('AC: aunque el switch mande activo desmarcado (ausente), la plantilla se queda activa (nunca se puede desactivar)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getPlantillasCsrfToken(agent);

    await agent
      .put(`/plantillas/${predeterminada.id}`)
      .type('form')
      .set('x-csrf-token', csrfToken)
      .send({ texto_respuesta: predeterminada.texto_respuesta }); // sin "activo" en el body

    const row = await db('plantillas_whatsapp').where({ id: predeterminada.id }).first();
    expect(row.activo).toBe(true);
  });

  it('AC: el formulario de edición no muestra el switch Activo/Inactivo, muestra una nota en su lugar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/plantillas/${predeterminada.id}/editar`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('name="activo"');
    expect(res.text).toContain('predeterminada del sistema');
  });

  it('AC: el detalle (Ver) muestra la nota de plantilla predeterminada', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/plantillas/${predeterminada.id}/ver`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('predeterminada del sistema');
  });
});
