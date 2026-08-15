// US-609: catálogo de áreas — mismo patrón que doctores.test.js (tabla
// estándar del sistema). Requiere una base de datos real migrada y
// sembrada (ver tests/integration/auth.test.js para el porqué).
//
// Nota deliberada: a diferencia de doctores.test.js, este archivo NO prueba
// el escenario "catálogo totalmente vacío" a nivel de integración — la
// tabla `areas` también la usa doctores.test.js (crea su propia área de
// prueba), y Jest corre los archivos de test en paralelo contra la misma
// BD, así que "areas está vacía" no es un estado que se pueda garantizar
// sin una condición de carrera entre archivos (mismo tipo de problema ya
// documentado para `session`/`usuarios`, ver memoria del proyecto). Esa
// lógica (catalogoVacio) ya está cubierta sin ese riesgo en
// tests/unit/areas.service.test.js, con el repository mockeado.
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SOLO_VER_USER = { username: 'solo.ver.areas.test', password: 'SoloVerTest123!' };
const SIN_PERMISOS_USER = { username: 'sin.permisos.areas.test', password: 'SinPermisosTest123!' };

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

async function getAreasCsrfToken(agent) {
  const res = await agent.get('/areas.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

// HTMX manda el <form> con la codificación por defecto de un form HTML
// (application/x-www-form-urlencoded), no JSON — .type('form') replica
// eso en vez de dejar que supertest mande JSON por default (ver el bug
// real de doctores.controller.js que esto habría atrapado desde el día 1).
async function filtrarAreas(agent, body) {
  const csrfToken = await getAreasCsrfToken(agent);
  return agent.post('/areas.html').type('form').set('x-csrf-token', csrfToken).send(body);
}

const SUFFIX = 'QA609';
async function cleanup() {
  // "contains", no "termina en": US-610 le agrega un sufijo numérico al
  // slug si el nombre se reutiliza (p.ej. "reutilizable-qa609-2") — un
  // patrón que exigiera terminar exacto en "-qa609" dejaba esas filas sin
  // limpiar entre corridas, acumulando duplicados que hacían flaky el test
  // de reutilización de nombre (una `.first()` sin ORDER BY podía agarrar
  // una fila vieja en vez de la recién creada).
  await db('areas').where('slug', 'like', `%${SUFFIX.toLowerCase()}%`).del();

  const usernames = [SOLO_VER_USER.username, SIN_PERMISOS_USER.username];
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
      apellidos: 'US609',
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
  await createTestUser(SOLO_VER_USER, ['areas.ver']);
  await createTestUser(SIN_PERMISOS_USER, []);

  await db('areas').insert({
    nombre: `Cardiología ${SUFFIX}`,
    slug: `cardiologia-${SUFFIX.toLowerCase()}`,
    activo: true,
    creado_en: db.fn.now(),
  });
  await db('areas').insert({
    nombre: `Dermatología ${SUFFIX}`,
    slug: `dermatologia-${SUFFIX.toLowerCase()}`,
    activo: true,
    creado_en: db.fn.now(),
  });
  await db('areas').insert({
    nombre: `Radiología ${SUFFIX}`,
    slug: `radiologia-${SUFFIX.toLowerCase()}`,
    activo: false,
    creado_en: db.fn.now(),
  });
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /areas.html', () => {
  it('AC: la carga inicial lista solo activas, con nombre/slug/estado y sin la inactiva', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/areas.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Cardiología ${SUFFIX}`);
    expect(res.text).toContain(`cardiologia-${SUFFIX.toLowerCase()}`);
    expect(res.text).toContain(`Dermatología ${SUFFIX}`);
    expect(res.text).not.toContain(`Radiología ${SUFFIX}`); // inactiva, no aparece por defecto
  });

  it('un GET con query string a mano se ignora por completo (privacidad: nunca se lee ni se refleja)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/areas.html?estado=todos&q=${SUFFIX}`);

    expect(res.text).not.toContain(`Radiología ${SUFFIX}`); // si leyera estado=todos, aparecería
  });

  it('POST con estado=todos incluye también a las inactivas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarAreas(agent, { estado: 'todos', q: SUFFIX });

    expect(res.status).toBe(200);
    expect(res.text).toContain(`Radiología ${SUFFIX}`);
  });

  it('POST con q=dermat encuentra el área por nombre o slug', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarAreas(agent, { q: 'dermat' });

    expect(res.text).toContain(`Dermatología ${SUFFIX}`);
    expect(res.text).not.toContain(`Cardiología ${SUFFIX}`);
  });

  it('POST sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.post('/areas.html').send({ estado: 'todos' });

    expect(res.status).toBe(403);
  });

  it('un usuario con solo areas.ver no ve los botones de crear/editar/eliminar', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/areas.html');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Nueva área');
    expect(res.text).not.toContain('row-action-edit');
    expect(res.text).not.toContain('row-action-delete');
  });

  it('un usuario sin areas.ver es rebotado a /main.html al pedir /areas.html directo', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/areas.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin areas.ver recibe HX-Redirect (no un 302 normal) cuando la petición viene de HTMX', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    await agent.post('/login').set('x-csrf-token', csrfToken).send(SIN_PERMISOS_USER);

    const res = await agent
      .post('/areas.html')
      .set('HX-Request', 'true')
      .set('x-csrf-token', 'no-importa-porque-el-permiso-falla-antes')
      .send({ estado: 'todos' });

    expect(res.status).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/main.html');
  });

  describe('orden de la tabla por header (POST sort=&dir=)', () => {
    it('sort=nombre&dir=asc (por defecto) ordena alfabéticamente', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, {
        estado: 'todos',
        q: SUFFIX,
        sort: 'nombre',
        dir: 'asc',
      });

      const idxCardio = res.text.indexOf(`Cardiología ${SUFFIX}`);
      const idxDermato = res.text.indexOf(`Dermatología ${SUFFIX}`);
      const idxRadio = res.text.indexOf(`Radiología ${SUFFIX}`);
      expect(idxCardio).toBeLessThan(idxDermato);
      expect(idxDermato).toBeLessThan(idxRadio);
    });

    it('sort=nombre&dir=desc invierte el orden', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, {
        estado: 'todos',
        q: SUFFIX,
        sort: 'nombre',
        dir: 'desc',
      });

      const idxCardio = res.text.indexOf(`Cardiología ${SUFFIX}`);
      const idxDermato = res.text.indexOf(`Dermatología ${SUFFIX}`);
      const idxRadio = res.text.indexOf(`Radiología ${SUFFIX}`);
      expect(idxRadio).toBeLessThan(idxDermato);
      expect(idxDermato).toBeLessThan(idxCardio);
    });

    it('sort=estado agrupa por activa/inactiva respetando la dirección', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const asc = await filtrarAreas(agent, {
        estado: 'todos',
        q: SUFFIX,
        sort: 'estado',
        dir: 'asc',
      });
      const desc = await filtrarAreas(agent, {
        estado: 'todos',
        q: SUFFIX,
        sort: 'estado',
        dir: 'desc',
      });

      // activo=false ordena antes que activo=true en ascendente, y al revés en descendente.
      expect(asc.text.indexOf(`Radiología ${SUFFIX}`)).toBeLessThan(
        asc.text.indexOf(`Cardiología ${SUFFIX}`),
      );
      expect(desc.text.indexOf(`Cardiología ${SUFFIX}`)).toBeLessThan(
        desc.text.indexOf(`Radiología ${SUFFIX}`),
      );
    });

    it('sort=slug ordena por slug', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, {
        estado: 'todos',
        q: SUFFIX,
        sort: 'slug',
        dir: 'asc',
      });

      const idxCardio = res.text.indexOf(`cardiologia-${SUFFIX.toLowerCase()}`);
      const idxDermato = res.text.indexOf(`dermatologia-${SUFFIX.toLowerCase()}`);
      const idxRadio = res.text.indexOf(`radiologia-${SUFFIX.toLowerCase()}`);
      expect(idxCardio).toBeLessThan(idxDermato);
      expect(idxDermato).toBeLessThan(idxRadio);
    });

    it('una columna de orden desconocida no truena, cae al orden por nombre', async () => {
      const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const res = await filtrarAreas(agent, { estado: 'todos', q: SUFFIX, sort: 'algo-invalido' });

      expect(res.status).toBe(200);
      expect(res.text).toContain(`Cardiología ${SUFFIX}`);
    });
  });
});

describe('DELETE /areas/:id (US-611 — baja lógica)', () => {
  let areaId;
  let areaId2;

  // Dos áreas que comparten substring de búsqueda ("Baja") — necesario para
  // el test de abajo que reproduce el bug real ya conocido de doctores.html:
  // HTMX manda los valores incluidos vía hx-include como QUERY STRING en un
  // DELETE (`methodsThatUseUrlParams` trae "delete" por default, igual que
  // "get"), no como body. Un test que solo mande el body no lo detecta.
  beforeAll(async () => {
    const [area] = await db('areas')
      .insert({
        nombre: `Baja ${SUFFIX}`,
        slug: `baja-${SUFFIX.toLowerCase()}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    areaId = area.id;

    const [area2] = await db('areas')
      .insert({
        nombre: `Bajado ${SUFFIX}`,
        slug: `bajado-${SUFFIX.toLowerCase()}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    areaId2 = area2.id;
  });

  // Los tests de este describe dependen del orden (Jest corre los `it` de un
  // mismo archivo en orden, sin paralelizar): el primero desactiva el área,
  // el segundo confirma que sigue existiendo con estado=todos — el flujo
  // AC de la historia, no dos casos aislados.
  it('AC: desactiva (activo=false, desactivado_por/desactivado_en), sin DELETE físico, y el fragmento respeta el filtro/búsqueda activo', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getAreasCsrfToken(agent);

    const res = await agent
      .delete(`/areas/${areaId}`)
      .query({ estado: 'activos', q: 'Baja' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`Baja ${SUFFIX}`); // recién desactivada, ya no aparece
    expect(res.text).toContain(`Bajado ${SUFFIX}`); // el otro match de "Baja" sigue activo
    // "1 resultados" es el assert que realmente distingue el bug: si el
    // fragmento hubiera vuelto al estado por defecto (req.body vacío en vez
    // de req.query), aparecerían TODAS las demás áreas activas de la base.
    expect(res.text).toContain('1 resultados');

    const row = await db('areas').where({ id: areaId }).first();
    expect(row.activo).toBe(false);
    expect(row.desactivado_por).not.toBeNull();
    expect(row.desactivado_en).not.toBeNull();
  });

  it('el registro sigue existiendo (no fue un DELETE físico) y aparece con estado=todos', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await filtrarAreas(agent, { estado: 'todos', q: SUFFIX });

    expect(res.text).toContain(`Baja ${SUFFIX}`);
    expect(res.text).toContain('Inactivo');
  });

  it('sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.delete(`/areas/${areaId2}`).query({ estado: 'todos' });

    expect(res.status).toBe(403);
  });

  it('un usuario con areas.ver pero sin areas.eliminar es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.delete(`/areas/${areaId2}`).query({ estado: 'todos' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un id inválido no truena, responde 200 sin tronar', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getAreasCsrfToken(agent);

    const res = await agent
      .delete('/areas/no-es-un-id')
      .query({ estado: 'todos' })
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
  });
});

describe('GET /areas/nuevo y GET /areas/:id/editar (US-610 — formulario)', () => {
  let areaId;

  beforeAll(async () => {
    const [area] = await db('areas')
      .insert({
        nombre: `Oftalmología ${SUFFIX}`,
        slug: `oftalmologia-${SUFFIX.toLowerCase()}`,
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    areaId = area.id;
  });

  it('AC: el formulario de alta abre vacío, con título "Nueva área" y sin campo de slug', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/areas/nuevo');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nueva área');
    expect(res.text).not.toContain('Editar área');
    expect(res.text).not.toContain('readonly');
  });

  it('AC: el formulario de edición trae el nombre precargado, título "Editar área", y el slug de solo lectura', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get(`/areas/${areaId}/editar`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Editar área');
    expect(res.text).toContain(`value="Oftalmología ${SUFFIX}"`);
    expect(res.text).toContain(`value="oftalmologia-${SUFFIX.toLowerCase()}"`);
    expect(res.text).toContain('readonly');
  });

  it('un usuario sin areas.crear no puede abrir el formulario de alta', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get('/areas/nuevo');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario sin areas.editar no puede abrir el formulario de edición', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent.get(`/areas/${areaId}/editar`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /areas y PUT /areas/:id (US-610 — alta y edición)', () => {
  async function crearArea(agent, nombre) {
    const csrfToken = await getAreasCsrfToken(agent);
    return agent.post('/areas').type('form').set('x-csrf-token', csrfToken).send({ nombre });
  }

  async function editarArea(agent, id, nombre) {
    const csrfToken = await getAreasCsrfToken(agent);
    return agent.put(`/areas/${id}`).type('form').set('x-csrf-token', csrfToken).send({ nombre });
  }

  it('AC: alta sin id genera el slug a partir del nombre y hace el swap out-of-band de la tabla', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await crearArea(agent, `Nutrición Clínica ${SUFFIX}`);

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeAreaModal');
    expect(res.text).toContain('hx-swap-oob="true"');

    const row = await db('areas')
      .where('slug', `nutricion-clinica-${SUFFIX.toLowerCase()}`)
      .first();
    expect(row).toBeDefined();
    expect(row.nombre).toBe(`Nutrición Clínica ${SUFFIX}`);
    expect(row.activo).toBe(true);
    expect(row.creado_por).not.toBeNull();
  });

  it('AC: un nombre duplicado con un área activa muestra el error y no cierra el modal ni crea el registro', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const nombre = `Duplicada ${SUFFIX}`;
    await crearArea(agent, nombre); // primera, debe quedar activa

    const res = await crearArea(agent, nombre); // segunda con el mismo nombre

    expect(res.status).toBe(200);
    expect(res.text).toContain('El nombre del Área ya esta registrada');
    expect(res.headers['hx-trigger']).toBeUndefined(); // no se cierra el modal
    expect(res.text).not.toContain('hx-swap-oob'); // no se refrescó la tabla

    const count = await db('areas').where('nombre', nombre).count('* as total').first();
    expect(Number(count.total)).toBe(1); // no se insertó una segunda fila
  });

  it('AC: el nombre de un área ya dada de baja se REACTIVA (no se crea una fila nueva ni se regenera el slug)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const nombre = `Reutilizable ${SUFFIX}`;

    const primera = await crearArea(agent, nombre);
    expect(primera.status).toBe(200);
    const primeraRow = await db('areas').where({ nombre, activo: true }).first();

    const csrfToken = await getAreasCsrfToken(agent);
    const bajaRes = await agent
      .delete(`/areas/${primeraRow.id}`)
      .query({})
      .set('x-csrf-token', csrfToken);
    expect(bajaRes.status).toBe(200);
    const primeraTrasBaja = await db('areas').where({ id: primeraRow.id }).first();
    expect(primeraTrasBaja.activo).toBe(false);

    const segunda = await crearArea(agent, nombre);

    expect(segunda.status).toBe(200);
    expect(segunda.text).toContain('hx-swap-oob="true"'); // sí se procesó, no hubo error de duplicado

    // El nombre sigue siendo único de verdad en la base (constraint del
    // script original, sin tocar) — "reutilizar" significa reactivar el
    // MISMO registro, no crear uno paralelo.
    const todas = await db('areas').where({ nombre });
    expect(todas).toHaveLength(1);
    expect(todas[0].id).toBe(primeraRow.id);
    expect(todas[0].slug).toBe(primeraRow.slug); // el slug original se conserva, no se regenera
    expect(todas[0].activo).toBe(true);
    expect(todas[0].desactivado_por).toBeNull();
    expect(todas[0].desactivado_en).toBeNull();
  });

  it('AC: el nombre de un área desactivada bloquea la edición de OTRA área a ese mismo nombre (no hay reactivar al editar)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const nombreBaja = `RetiradaParaEdicion ${SUFFIX}`;
    await crearArea(agent, nombreBaja);
    const areaBaja = await db('areas').where({ nombre: nombreBaja }).first();
    const csrfToken = await getAreasCsrfToken(agent);
    await agent.delete(`/areas/${areaBaja.id}`).query({}).set('x-csrf-token', csrfToken);

    await crearArea(agent, `OtraArea ${SUFFIX}`);
    const otraArea = await db('areas').where('nombre', `OtraArea ${SUFFIX}`).first();

    const res = await editarArea(agent, otraArea.id, nombreBaja);

    expect(res.status).toBe(200);
    expect(res.text).toContain('El nombre del Área ya esta registrada');
    const sinCambios = await db('areas').where({ id: otraArea.id }).first();
    expect(sinCambios.nombre).toBe(`OtraArea ${SUFFIX}`); // no se tocó
  });

  it('AC: la edición actualiza solo el nombre, nunca el slug', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    await crearArea(agent, `Original ${SUFFIX}`);
    const original = await db('areas').where('nombre', `Original ${SUFFIX}`).first();

    const res = await editarArea(agent, original.id, `Renombrada ${SUFFIX}`);

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeAreaModal');

    const actualizada = await db('areas').where({ id: original.id }).first();
    expect(actualizada.nombre).toBe(`Renombrada ${SUFFIX}`);
    expect(actualizada.slug).toBe(original.slug); // el slug no cambió
    expect(actualizada.actualizado_por).not.toBeNull();
    expect(actualizada.actualizado_en).not.toBeNull();
  });

  it('AC: editar sin cambiar el nombre no choca consigo misma (excluye el propio id del chequeo de duplicados)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const nombre = `SinCambios ${SUFFIX}`;
    await crearArea(agent, nombre);
    const area = await db('areas').where({ nombre }).first();

    const res = await editarArea(agent, area.id, nombre);

    expect(res.status).toBe(200);
    expect(res.headers['hx-trigger']).toBe('closeAreaModal');
  });

  it('AC: editar a un nombre usado por OTRA área activa muestra el error y no actualiza', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    await crearArea(agent, `Ocupada ${SUFFIX}`);
    await crearArea(agent, `PorEditar ${SUFFIX}`);
    const porEditar = await db('areas').where('nombre', `PorEditar ${SUFFIX}`).first();

    const res = await editarArea(agent, porEditar.id, `Ocupada ${SUFFIX}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('El nombre del Área ya esta registrada');
    expect(res.headers['hx-trigger']).toBeUndefined();

    const sinCambios = await db('areas').where({ id: porEditar.id }).first();
    expect(sinCambios.nombre).toBe(`PorEditar ${SUFFIX}`); // no se tocó
  });

  it('POST /areas sin token CSRF es rechazado', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent
      .post('/areas')
      .type('form')
      .send({ nombre: `SinCsrf ${SUFFIX}` });

    expect(res.status).toBe(403);
  });

  it('un usuario con solo areas.ver no puede dar de alta', async () => {
    const agent = await loginAs(SOLO_VER_USER);

    const res = await agent
      .post('/areas')
      .type('form')
      .send({ nombre: `SinPermiso ${SUFFIX}` });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('un usuario con solo areas.ver no puede editar', async () => {
    const agent = await loginAs(SOLO_VER_USER);
    const adminAgent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    await crearArea(adminAgent, `ParaEditarSinPermiso ${SUFFIX}`);
    const area = await db('areas').where('nombre', `ParaEditarSinPermiso ${SUFFIX}`).first();

    const res = await agent.put(`/areas/${area.id}`).type('form').send({ nombre: 'Lo que sea' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});
