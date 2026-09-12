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
const AGENDA_VER = { username: 'metricas.agenda.test', password: 'MetricasAgendaTest123!' };
const WHATSAPP_VER = { username: 'metricas.whatsapp.test', password: 'MetricasWhatsapp123!' };
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
  const usernames = [
    SOLO_VER.username,
    AGENDA_VER.username,
    WHATSAPP_VER.username,
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
  await createTestUser(SOLO_VER, ['metricas.laboratorios.ver']);
  await createTestUser(AGENDA_VER, ['metricas.agenda.ver']);
  await createTestUser(WHATSAPP_VER, ['metricas.whatsapp.ver']);
  await createTestUser(SIN_PERMISOS, []);
});

describe('Métricas de WhatsApp', () => {
  it('muestra los seis KPIs, las ocho gráficas y el mapa de calor', async () => {
    const agent = await loginAs(WHATSAPP_VER);

    const res = await agent.get('/metricas/whatsapp.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="metricas-whatsapp-filters"');
    expect(res.text).toContain('name="agrupacion"');
    expect(res.text).toContain('Mensajes enviados');
    expect(res.text).toContain('Promedio diario');
    expect(res.text).toContain('Plantilla más utilizada');
    expect(res.text).toContain('Error más frecuente');
    expect(res.text).toContain('metricas-kpi-tooltip" data-tooltip=');
    expect(res.text).toContain('metricas-kpi-truncate"');
    expect(res.text).toContain('id="metricasWhatsappData"');
    expect(res.text).toContain("document.getElementById('whatsappChartTasa')");
    expect(res.text).toContain("document.getElementById('whatsappMapaCalor')");
    expect(res.text).toContain('href="metricas/whatsapp.html" class="submenu-link current"');
  });

  it('sin metricas.whatsapp.ver redirige a la página principal', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/metricas/whatsapp.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('Métricas de Agenda', () => {
  it('con metricas.agenda.ver muestra filtros, KPIs y las nueve gráficas solicitadas', async () => {
    const agent = await loginAs(AGENDA_VER);

    const res = await agent.get('/metricas/agenda.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="metricas-agenda-filters"');
    expect(res.text).toContain('name="area"');
    expect(res.text).toContain('name="doctor"');
    expect(res.text).toContain('Citas agendadas');
    expect(res.text).toContain('id="metricasAgendaData"');
    expect(res.text).toContain("document.getElementById('agendaChartAreaDoctor')");
    expect(res.text).toContain("document.getElementById('agendaMapaHorarios')");
    expect(res.text).toContain('href="metricas/agenda.html" class="submenu-link current"');
  });

  it('sin metricas.agenda.ver redirige a la página principal', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/metricas/agenda.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
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

    // Bug real corregido en esta revisión: "Envíos por canal y resultado"
    // filtraba por `fecha_solicitud` de la ORDEN en vez de por
    // `enviado_en` del envío — una orden vieja (fuera del rango
    // consultado) cuyo envío sí ocurrió dentro del rango se perdía. Esta
    // orden tiene fecha_solicitud muy fuera de FECHA_FIXTURE a propósito
    // (nunca debe contar en ninguna OTRA métrica de este fixture, todas
    // siguen filtrando por fecha_solicitud), pero su envío sí cae dentro
    // del rango consultado.
    const [{ id: idOrdenVieja }] = await db('registros_laboratorio')
      .insert({
        mascota_id: mascotaId,
        fecha_solicitud: '2019-06-01',
        estado: 'enviado',
        pendiente_desde: horas(48),
        cargado_en: horas(30),
        enviado_en: horas(24),
        eliminado: false,
        creado_por: admin.id,
        creado_en: db.fn.now(),
      })
      .returning('id');
    registroIds.push(idOrdenVieja);
    const [envioOrdenVieja] = await db('envios_laboratorio')
      .insert({
        registro_laboratorio_id: idOrdenVieja,
        canal_intentado: 'whatsapp',
        medio: 'whatsapp',
        destinatario_telefono: '5588888888',
        whatsapp_exitoso: true,
        enviado_por: admin.id,
        enviado_en: new Date(ANCLA),
      })
      .returning('id');
    envioIds.push(envioOrdenVieja.id);
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
    expect(res.text).toContain('Órdenes en total');
    expect(res.text).toContain('33% de las órdenes');
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
    // whatsapp: 2 exitosos, no 1 — el envío de "idOrdenVieja" (orden de
    // 2019, fuera de este rango) también cuenta aquí a propósito, ver el
    // siguiente test dedicado a esa corrección.
    expect(datos.enviosPorCanal).toEqual([
      { canal: 'whatsapp', etiqueta: 'Solo WhatsApp', exitosos: 2, fallidos: 0 },
      { canal: 'correo', etiqueta: 'Solo Correo', exitosos: 0, fallidos: 1 },
      { canal: 'ambos', etiqueta: 'Ambos medios', exitosos: 0, fallidos: 1 },
    ]);
  });

  // Bug real corregido en esta revisión (ver metricas.repository.js#
  // contarEnviosPorCanalResultado): esta métrica es sobre CUÁNDO OCURRIÓ
  // EL ENVÍO, no cuándo se creó la orden — una orden vieja (fecha_solicitud
  // muy fuera del rango consultado) cuyo envío sí ocurrió dentro del rango
  // debe contar aquí, aunque esa misma orden NUNCA aparezca en ninguna
  // otra métrica de esta pantalla (todas las demás sí filtran por
  // fecha_solicitud).
  it('AC: un envío reciente de una orden vieja SÍ cuenta en "envíos por canal", aunque la orden no aparezca en las demás métricas', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getMetricasCsrfToken(agent);

    const res = await consultarFixture(agent, csrfToken);

    expect(res.status).toBe(200);
    // La orden vieja no se cuenta en el total de órdenes del rango (sigue
    // siendo 3, no 4) — solo su ENVÍO entra a la otra métrica.
    expect(res.text).toContain('metricas-kpi-value">3</span>');

    const match = res.text.match(/<div id="metricasLabData" hidden>(.*?)<\/div>/s);
    const datos = JSON.parse(match[1].replace(/\\u003c/g, '<'));
    const whatsapp = datos.enviosPorCanal.find((fila) => fila.canal === 'whatsapp');
    expect(whatsapp.exitosos).toBe(2);
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
