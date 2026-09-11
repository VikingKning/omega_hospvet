// Métricas de Laboratorio: primera pantalla del módulo de Métricas
// (pendiente desde US-604 — permiso ya sembrado, pantalla recién
// construida). Requiere una base de datos real migrada y sembrada (ver
// auth.test.js para el porqué).
//
// A propósito, este archivo NUNCA inserta en `doctores` — regla ya
// establecida en el proyecto (registros_laboratorio.doctor_id es
// nullable, se deja en null en todo el fixture).
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;

const SUFFIX = 'QAMETRICAS';

const SOLO_VER = { username: 'metricas.ver.test', password: 'MetricasVerTest123!' };
const SIN_PERMISOS = { username: 'metricas.sinpermiso.test', password: 'MetricasSinPermTest123!' };

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

// El formulario de rango de fechas siempre está presente (a diferencia de
// laboratorio.html, esta pantalla no tiene un estado "catálogo vacío" que
// lo oculte) — el token viaja en `hx-headers`, no en un `value=` plano.
async function getMetricasCsrfToken(agent) {
  const res = await agent.get('/metricas/laboratorio.html');
  const match = res.text.match(/hx-headers='\{"x-csrf-token": "([^"]+)"/);
  return match[1];
}

async function cleanup() {
  const usernames = [SOLO_VER.username, SIN_PERMISOS.username];
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
  await createTestUser(SOLO_VER, ['metricas.laboratorios.ver']);
  await createTestUser(SIN_PERMISOS, []);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /metricas/laboratorio.html', () => {
  it('AC: con metricas.laboratorios.ver, abre la página con el toolbar de rango de fechas', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/metricas/laboratorio.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="metricas-laboratorio-filters"');
  });

  it('un usuario sin metricas.laboratorios.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/metricas/laboratorio.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  // Bug real encontrado al construir esta pantalla (ver sidebar.ejs): el
  // link de "Laboratorios" bajo Métricas usaba un código de permiso que no
  // coincidía con el sembrado — el grupo completo nunca se mostraba, para
  // nadie. Corregido junto con esta pantalla.
  it('AC: el link "Laboratorios" del sidebar aparece y queda marcado como actual', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/metricas/laboratorio.html');

    expect(res.text).toContain('href="metricas/laboratorio.html" class="submenu-link current"');
  });
});

describe('POST /metricas/laboratorio.html (rango de fechas + agregados)', () => {
  // Fecha fija en el pasado (nunca "hoy"), aislada a propósito: los
  // agregados de esta pantalla (conteos, promedios) son sobre TODA la
  // tabla `registros_laboratorio`, compartida con otros archivos de test
  // que sí insertan con fecha_solicitud=hoy y corren en paralelo (ver
  // laboratorio.test.js) — usar un rango fijo y distintivo, consultado con
  // ese mismo rango exacto (nunca un preset relativo a "ahora"), es la
  // única forma de afirmar un número EXACTO sin que otro archivo lo
  // contamine.
  const FECHA_FIXTURE = '2021-03-15';
  const ANCLA = new Date(`${FECHA_FIXTURE}T12:00:00Z`).getTime();

  let propietarioId;
  let mascotaId;
  let estudioId;
  let categoriaNombre;
  const registroIds = [];
  const envioIds = [];

  beforeAll(async () => {
    const [{ id: propId }] = await db('propietarios')
      .insert({
        nombre: 'Metricas',
        apellidos: SUFFIX,
        telefono: '5588888888',
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    propietarioId = propId;
    const [{ id: mascId }] = await db('mascotas')
      .insert({
        propietario_id: propietarioId,
        nombre: 'MetricasTest',
        tipo: 'perro',
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    mascotaId = mascId;

    const admin = await db('usuarios').where('username', ADMIN_USERNAME).first('id');
    const estudio = await db('catalogo_estudios as ce')
      .join('catalogo_categorias_estudio as cc', 'cc.id', 'ce.categoria_id')
      .where('ce.activo', true)
      .first('ce.id', 'ce.nombre', 'cc.nombre as categoria_nombre');
    estudioId = estudio.id;
    categoriaNombre = estudio.categoria_nombre;

    const horas = (n) => new Date(ANCLA - n * 60 * 60 * 1000);

    // 3 registros con estados/tiempos conocidos: uno pendiente (sin
    // cargar/enviar todavía), uno cargado (2h desde pendiente), uno
    // enviado (2h a cargado, 3h más a enviado — 5h totales).
    const [{ id: idPendiente }] = await db('registros_laboratorio')
      .insert({
        mascota_id: mascotaId,
        fecha_solicitud: FECHA_FIXTURE,
        estado: 'pendiente',
        pendiente_desde: horas(0),
        eliminado: false,
        creado_por: admin.id,
        creado_en: db.fn.now(),
      })
      .returning('id');
    const [{ id: idCargado }] = await db('registros_laboratorio')
      .insert({
        mascota_id: mascotaId,
        fecha_solicitud: FECHA_FIXTURE,
        estado: 'cargado',
        pendiente_desde: horas(2),
        cargado_en: horas(0),
        eliminado: false,
        creado_por: admin.id,
        creado_en: db.fn.now(),
      })
      .returning('id');
    const [{ id: idEnviado }] = await db('registros_laboratorio')
      .insert({
        mascota_id: mascotaId,
        fecha_solicitud: FECHA_FIXTURE,
        estado: 'enviado',
        pendiente_desde: horas(5),
        cargado_en: horas(3),
        enviado_en: horas(0),
        eliminado: false,
        creado_por: admin.id,
        creado_en: db.fn.now(),
      })
      .returning('id');
    registroIds.push(idPendiente, idCargado, idEnviado);

    await db('estudios_solicitados').insert(
      registroIds.map((registroLaboratorioId) => ({
        registro_laboratorio_id: registroLaboratorioId,
        estudio_id: estudioId,
        estado: 'pendiente',
        creado_en: db.fn.now(),
      })),
    );

    const envios = await db('envios_laboratorio')
      .insert([
        {
          registro_laboratorio_id: idPendiente,
          canal_intentado: 'whatsapp',
          medio: 'whatsapp',
          destinatario_telefono: '5588888888',
          whatsapp_exitoso: true,
          enviado_por: admin.id,
          enviado_en: new Date(ANCLA),
        },
        {
          registro_laboratorio_id: idCargado,
          canal_intentado: 'correo',
          medio: null,
          destinatario_correo: 'fallo@omegavet.test',
          correo_exitoso: false,
          error_correo: 'SMTP de prueba no disponible',
          enviado_por: admin.id,
          enviado_en: new Date(ANCLA),
        },
        {
          registro_laboratorio_id: idEnviado,
          canal_intentado: 'ambos',
          medio: 'correo',
          destinatario_correo: 'exito@omegavet.test',
          destinatario_telefono: '5588888888',
          correo_exitoso: true,
          whatsapp_exitoso: false,
          error_whatsapp: 'Meta de prueba rechazó el envío',
          enviado_por: admin.id,
          enviado_en: new Date(ANCLA),
        },
      ])
      .returning('id');
    envioIds.push(...envios.map((envio) => envio.id));
  });

  afterAll(async () => {
    await db('envios_laboratorio').whereIn('id', envioIds).del();
    await db('estudios_solicitados').whereIn('registro_laboratorio_id', registroIds).del();
    await db('registros_laboratorio').whereIn('id', registroIds).del();
    await db('mascotas').where('id', mascotaId).del();
    await db('propietarios').where('id', propietarioId).del();
  });

  async function consultarFixture(agent, csrfToken) {
    return agent
      .post('/metricas/laboratorio.html')
      .set('x-csrf-token', csrfToken)
      .send({ desde: FECHA_FIXTURE, hasta: FECHA_FIXTURE });
  }

  it('AC: el total y el desglose por estado cuentan exactamente los 3 registros del fixture', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getMetricasCsrfToken(agent);

    const res = await consultarFixture(agent, csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).toContain('metricas-kpi-value">3</span>'); // Total de órdenes
    expect(res.text).toContain('metricas-kpi-value">1</span>'); // cada estado tiene exactamente 1
  });

  it('AC: los tiempos promedio de atención reflejan las horas exactas del fixture', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getMetricasCsrfToken(agent);

    const res = await consultarFixture(agent, csrfToken);

    expect(res.status).toBe(200);
    expect(res.text).toContain('2 h'); // pendiente -> cargado
    expect(res.text).toContain('3 h'); // cargado -> enviado
    expect(res.text).toContain('5 h'); // pendiente -> enviado
  });

  it('AC: el estudio/categoría del fixture aparece en la isla de datos para las gráficas', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getMetricasCsrfToken(agent);

    const res = await consultarFixture(agent, csrfToken);

    const match = res.text.match(/<div id="metricasLabData" hidden>(.*?)<\/div>/s);
    const datos = JSON.parse(match[1].replace(/\\u003c/g, '<'));

    expect(datos.topEstudios.some((f) => f.total === 3)).toBe(true);
    expect(datos.topCategorias.map((f) => f.nombre)).toContain(categoriaNombre);
  });

  it('AC: entrega los datos de recepción, especie y antigüedad para las nuevas gráficas', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getMetricasCsrfToken(agent);

    const res = await consultarFixture(agent, csrfToken);
    const match = res.text.match(/<div id="metricasLabData" hidden>(.*?)<\/div>/s);
    const datos = JSON.parse(match[1].replace(/\\u003c/g, '<'));

    expect(res.text).toContain('id="metricasMapaRecepcion"');
    expect(res.text).toContain('id="metricasChartEspecies"');
    expect(res.text).toContain('id="metricasChartAntiguedad"');
    expect(datos.mapaRecepcion.flatMap((dia) => dia.horas).reduce((a, b) => a + b, 0)).toBe(3);
    expect(datos.porEspecie).toEqual([
      { especie: 'perro', etiqueta: 'Perros', total: 3 },
      { especie: 'gato', etiqueta: 'Gatos', total: 0 },
    ]);
    expect(datos.antiguedadAbiertas.find((fila) => fila.rango === 'mas_3d')).toMatchObject({
      pendiente: 1,
      cargado: 1,
    });
    expect(res.text).toContain('id="metricasChartEnviosCanal"');
    expect(datos.enviosPorCanal).toEqual([
      { canal: 'whatsapp', etiqueta: 'Solo WhatsApp', exitosos: 1, fallidos: 0 },
      { canal: 'correo', etiqueta: 'Solo Correo', exitosos: 0, fallidos: 1 },
      { canal: 'ambos', etiqueta: 'Ambos medios', exitosos: 0, fallidos: 1 },
    ]);
  });

  it('AC: un rango de fechas que no cubre el fixture no encuentra los registros', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getMetricasCsrfToken(agent);

    const res = await agent
      .post('/metricas/laboratorio.html')
      .set('x-csrf-token', csrfToken)
      .send({ desde: '2019-01-01', hasta: '2019-01-01' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('No hay órdenes en este rango de fechas');
  });
});
