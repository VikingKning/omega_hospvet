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
const SOLO_CARGAR = { username: 'laboratorio.cargar.test', password: 'LaboratorioCargarTest123!' };
const SOLO_ENVIAR = { username: 'laboratorio.enviar.test', password: 'LaboratorioEnviarTest123!' };

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
    SOLO_CARGAR.username,
    SOLO_ENVIAR.username,
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
  await createTestUser(SOLO_CARGAR, ['laboratorio.ver', 'laboratorio.cargar']);
  await createTestUser(SOLO_ENVIAR, [
    'laboratorio.ver',
    'laboratorio.cargar',
    'laboratorio.enviar',
  ]);
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
    expect(res.text).toContain('id="labDoctorCedula"');
    expect(res.text).toContain('id="labPrintDoctorCedula"');
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

  it('organiza Imagenología por modalidad y solicita zona solo cuando aporta información', async () => {
    const agent = await loginAs(SOLO_CREAR);
    const res = await agent.get('/laboratorio/nuevo');
    const match = res.text.match(/<div id="labFormData" hidden>(.*?)<\/div>/s);
    const datos = JSON.parse(match[1].replace(/\\u003c/g, '<'));
    const imagenologia = datos.catalogo.categorias.find(
      (categoria) => categoria.nombre === 'Imagenología',
    );
    const porNombre = new Map(imagenologia.estudios.map((estudio) => [estudio.nombre, estudio]));

    expect(porNombre.get('Radiografía simple').campoAdicional).toBe('zona');
    expect(porNombre.get('Radiografía de contraste').campoAdicional).toBe('zona');
    expect(porNombre.get('Ultrasonido').campoAdicional).toBe('zona');
    expect(porNombre.get('Ultrasonido gestacional').campoAdicional).toBeNull();
    expect(porNombre.has('Radiografía de cráneo')).toBe(false);
    expect(porNombre.has('Radiografía abdominal')).toBe(false);
    expect(porNombre.has('Serie radiográfica')).toBe(false);
    expect(porNombre.has('Ultrasonido abdominal')).toBe(false);
    expect(datos.catalogo.zonasAnatomicas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'dental', nombre: 'Dental' }),
        expect.objectContaining({ codigo: 'cuello', nombre: 'Cuello' }),
      ]),
    );

    const zonaIdPorCodigo = new Map(
      datos.catalogo.zonasAnatomicas.map((zona) => [zona.codigo, zona.id]),
    );
    expect(porNombre.get('Radiografía simple').zonasPermitidasIds).toContain(
      zonaIdPorCodigo.get('dental'),
    );
    expect(porNombre.get('Ultrasonido').zonasPermitidasIds).not.toContain(
      zonaIdPorCodigo.get('dental'),
    );
  });

  it('incluye los nuevos estudios diferenciados para Perro y Gato', async () => {
    const agent = await loginAs(SOLO_CREAR);
    const res = await agent.get('/laboratorio/nuevo');
    const match = res.text.match(/<div id="labFormData" hidden>(.*?)<\/div>/s);
    const datos = JSON.parse(match[1].replace(/\\u003c/g, '<'));
    const estudios = datos.catalogo.categorias.flatMap((categoria) => categoria.estudios);
    const nombresPorEspecie = (especie) =>
      estudios.filter((estudio) => estudio.especie === especie).map((estudio) => estudio.nombre);

    expect(nombresPorEspecie('Perro')).toEqual(
      expect.arrayContaining([
        'Función renal',
        'Perfil metabólico',
        'ALKP / Fosfatasa alcalina',
        'Uroanálisis completo',
        'Coprológico por flotación',
        'Coprológico funcional / digestivo',
        'Citología de piel',
        'Punción con aguja fina (PAF)',
      ]),
    );
    expect(nombresPorEspecie('Gato')).toEqual(
      expect.arrayContaining([
        'Prueba rápida ViLeF/VIF (FeLV/FIV)',
        'PCR para ViLeF/VIF (FeLV/FIV)',
        'Frotis sanguíneo felino',
        'ALKP / Fosfatasa alcalina',
        'Cardiopet proBNP felino',
        'Uroanálisis completo',
        'Coprológico por flotación',
        'Coprológico por extensión directa',
        'Perfil respiratorio felino',
        'Citología de raspado de oreja',
        'Punción con aguja fina (PAF) de masas hepáticas',
        'Punción con aguja fina (PAF) de nódulos tiroideos',
        'PCR para hemoplasmas',
      ]),
    );
  });

  it('ofrece antibiograma solo para cultivos bacterianos y elimina duplicados funcionales', async () => {
    const agent = await loginAs(SOLO_CREAR);
    const res = await agent.get('/laboratorio/nuevo');
    const match = res.text.match(/<div id="labFormData" hidden>(.*?)<\/div>/s);
    const datos = JSON.parse(match[1].replace(/\\u003c/g, '<'));
    const estudios = datos.catalogo.categorias.flatMap((categoria) =>
      categoria.estudios.map((estudio) => ({ ...estudio, categoria: categoria.nombre })),
    );

    const cultivosBacterianos = estudios.filter((estudio) =>
      /^(cultivo|urocultivo|hemocultivo)/i.test(estudio.nombre),
    );
    expect(cultivosBacterianos.some((estudio) => estudio.permiteAntibiograma)).toBe(true);
    expect(estudios.some((estudio) => estudio.nombre === 'Antibiograma')).toBe(false);
    expect(estudios.find((estudio) => estudio.nombre === 'Cultivo bacteriano aerobio')).toEqual(
      expect.objectContaining({ campoAdicional: 'tipo_muestra', permiteAntibiograma: true }),
    );
    expect(estudios.find((estudio) => estudio.nombre === 'Urocultivo')).toEqual(
      expect.objectContaining({ campoAdicional: null, permiteAntibiograma: true }),
    );
    expect(estudios.some((estudio) => estudio.nombre === 'Cultivo de orina / urocultivo')).toBe(
      false,
    );
    expect(
      estudios.find(
        (estudio) =>
          estudio.categoria === 'Dermatología' && estudio.nombre === 'Cultivo micológico',
      ),
    ).toBeUndefined();
    expect(
      estudios.find(
        (estudio) =>
          estudio.categoria === 'Toxicología' &&
          estudio.nombre === 'Análisis toxicológico de orina',
      ).campoAdicional,
    ).toBeNull();

    const duplicadosUniversales = estudios
      .filter((estudio) => !estudio.especie)
      .reduce(
        (conteo, estudio) => conteo.set(estudio.nombre, (conteo.get(estudio.nombre) ?? 0) + 1),
        new Map(),
      );
    expect([...duplicadosUniversales.entries()].filter(([, total]) => total > 1)).toEqual([]);
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

describe('POST /laboratorio.html (búsqueda por folio)', () => {
  // Pedido explícito del usuario: además de mascota/tutor/doctor, el
  // cuadro de búsqueda también encuentra por el folio del registro (el
  // mismo "LAB-XXX" que ya muestra la tabla) en cualquiera de sus 3 formas
  // — con prefijo, sin prefijo, con o sin ceros a la izquierda. Se crea un
  // registro real (mascota + propietario, sin tocar `doctores` — regla ya
  // establecida, ver el comentario al inicio del archivo) para tener un
  // folio conocido contra el cual buscar.
  let propietarioId;
  let mascotaId;
  let registroId;
  let folio;

  beforeAll(async () => {
    const admin = await db('usuarios').where('username', ADMIN_USERNAME).first('id');
    const [{ id: propId }] = await db('propietarios')
      .insert({
        nombre: 'Folio',
        apellidos: SUFFIX,
        telefono: '5599999999',
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    propietarioId = propId;
    const [{ id: mascId }] = await db('mascotas')
      .insert({
        propietario_id: propietarioId,
        nombre: 'FolioTest',
        tipo: 'perro',
        activo: true,
        creado_en: db.fn.now(),
      })
      .returning('id');
    mascotaId = mascId;
    const [{ id: regId }] = await db('registros_laboratorio')
      .insert({
        mascota_id: mascotaId,
        fecha_solicitud: new Date(),
        estado: 'pendiente',
        pendiente_desde: db.fn.now(),
        eliminado: false,
        creado_por: admin.id,
        creado_en: db.fn.now(),
      })
      .returning('id');
    registroId = regId;
    folio = `LAB-${String(registroId).padStart(3, '0')}`;
  });

  afterAll(async () => {
    await db('registros_laboratorio').where('id', registroId).del();
    await db('mascotas').where('id', mascotaId).del();
    await db('propietarios').where('id', propietarioId).del();
  });

  it.each([
    ['con el prefijo y ceros a la izquierda', () => folio],
    ['solo el número con ceros a la izquierda', () => String(registroId).padStart(3, '0')],
    ['solo el número, sin ceros a la izquierda', () => String(registroId)],
  ])('AC: encuentra el registro buscando %s', async (_descripcion, obtenerQuery) => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio.html').set('x-csrf-token', csrfToken).send({
      q: obtenerQuery(),
      estado: '',
      categoriaId: '',
      page: 1,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain(folio);
  });

  // Pedido explícito del usuario: "LAB-" es la construcción del folio, no
  // un dato buscable en sí — teclear un prefijo de esa construcción ("L",
  // "LA", "LAB", "LAB-") sin ningún número todavía debe mostrar TODOS los
  // registros, como si aún no se hubiera escrito el filtro.
  it.each([['L'], ['LA'], ['LAB'], ['LAB-']])(
    'AC: buscar "%s" (prefijo del folio, sin número) muestra todos los registros',
    async (q) => {
      const agent = await loginAs(SOLO_VER);
      const csrfToken = await getLaboratorioCsrfToken(agent);

      const res = await agent.post('/laboratorio.html').set('x-csrf-token', csrfToken).send({
        q,
        estado: '',
        categoriaId: '',
        page: 1,
      });

      expect(res.status).toBe(200);
      expect(res.text).toContain(folio);
    },
  );

  // Un nombre real que empieza distinto a "lab-" en algún punto (aunque
  // arranque con las mismas 3 letras) NUNCA debe disparar el "mostrar
  // todos" de arriba — solo debe resolverse por el ILIKE normal contra
  // mascota/tutor/doctor.
  it('un nombre como "Laban" no dispara el "mostrar todos" del prefijo de folio', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio.html').set('x-csrf-token', csrfToken).send({
      q: 'Laban',
      estado: '',
      categoriaId: '',
      page: 1,
    });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(folio);
  });

  // Pedido explícito del usuario: la búsqueda también encuentra por el
  // teléfono del tutor (propietarios.telefono, del fixture de arriba),
  // completo o parcial — mismo criterio de tutores.repository.js#baseQuery.
  it.each([
    ['el teléfono completo', () => '5599999999'],
    ['solo una parte del teléfono', () => '99999'],
  ])('AC: encuentra el registro buscando por %s', async (_descripcion, obtenerQuery) => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio.html').set('x-csrf-token', csrfToken).send({
      q: obtenerQuery(),
      estado: '',
      categoriaId: '',
      page: 1,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain(folio);
  });

  // Bug reportado por el usuario: buscar por el teléfono del tutor (10
  // dígitos) tronaba con 500 porque ese número, al no traer "LAB-", se
  // interpretaba como un posible folio y se mandaba tal cual a
  // `r.id = ?` — un entero de Postgres (int4) no admite un valor tan
  // grande y la consulta reventaba con "fuera de rango para el tipo
  // integer" en vez de simplemente resolverse (ahora) como búsqueda de
  // teléfono. Un número de un tutor que no existe en el fixture no debe
  // encontrar este registro, pero tampoco debe tronar.
  it('AC: buscar un número que no cabe en un integer de Postgres no truena (200, nunca 500)', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio.html').set('x-csrf-token', csrfToken).send({
      q: '5529000090',
      estado: '',
      categoriaId: '',
      page: 1,
    });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(folio);
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

    // Un id inexistente redirige al listado con un mensaje (pedido explícito
    // del usuario: nunca un 404 en blanco sin el diseño del sistema) — el
    // 302 (en vez de un no-op silencioso como eliminar) igual confirma que
    // el permiso de SOLO ver ya pasó el middleware de la ruta y llegó al
    // controller.
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/laboratorio.html?error=no-encontrado&id=999999');
  });

  it('un usuario sin laboratorio.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/laboratorio/999999/editar');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  // Bug reportado por el usuario: entrar a un id inexistente (o basura, ej.
  // /laboratorio/asdfasddfsdf/ver) mostraba un 404 en blanco sin el diseño
  // del sistema. Ahora regresa al listado y ese listado muestra un banner
  // cerrable con el id que se buscó.
  it('AC: un id no numérico también redirige al listado con un mensaje', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio/asdfasddfsdf/editar');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/laboratorio.html?error=no-encontrado&id=asdfasddfsdf');
  });

  it('AC: el listado, tras el redirect, muestra el banner con el id buscado', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio.html?error=no-encontrado&id=999999');

    expect(res.status).toBe(200);
    expect(res.text).toContain('El registro &#34;999999&#34; no existe.');
    expect(res.text).toContain('laboratorioBannerErrorDismiss');
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

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/laboratorio.html?error=no-encontrado&id=999999');
  });

  it('un usuario sin laboratorio.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/laboratorio/999999/ver');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

// Pantalla dedicada para "Subir resultados" (corrección explícita del
// usuario: NO es /ver — esa se queda puramente informativa). Permiso
// propio `laboratorio.cargar`, no `laboratorio.ver`.
describe('GET /laboratorio/:id/cargar', () => {
  it('AC: laboratorio.cargar alcanza para abrir la pantalla', async () => {
    const agent = await loginAs(SOLO_CARGAR);

    const res = await agent.get('/laboratorio/999999/cargar');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/laboratorio.html?error=no-encontrado&id=999999');
  });

  it('un usuario sin laboratorio.cargar es rebotado a /main.html (aunque tenga laboratorio.ver)', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio/999999/cargar');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

// Carga de archivos de resultados (pedido explícito del usuario) — solo
// permisos aquí (404 en id inexistente confirma que sí llegó al
// controller); la cobertura real de fusionar/guardar archivos vive en
// laboratorio.archivos.test.js y laboratorio.service.test.js (repository
// mockeado) — este archivo nunca inserta en `doctores` ni hace uploads
// reales, mismo criterio que el resto de la suite de integración.
describe('POST /laboratorio/:id/archivos', () => {
  it('AC: laboratorio.cargar alcanza para llegar al controller (404 en id inexistente)', async () => {
    const agent = await loginAs(SOLO_CARGAR);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio/999999/archivos').set('x-csrf-token', csrfToken);

    expect(res.status).toBe(404);
  });

  it('un usuario sin laboratorio.cargar es rebotado a /main.html (aunque tenga laboratorio.ver)', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio/999999/archivos').set('x-csrf-token', csrfToken);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('POST /laboratorio/:id/estudios/:estudioId/archivo', () => {
  it('AC: laboratorio.cargar alcanza para llegar al controller (404 en id inexistente)', async () => {
    const agent = await loginAs(SOLO_CARGAR);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent
      .post('/laboratorio/999999/estudios/1/archivo')
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(404);
  });

  it('un usuario sin laboratorio.cargar es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent
      .post('/laboratorio/999999/estudios/1/archivo')
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

// Quitar un archivo ya cargado (pedido explícito del usuario: "por si se
// equivocó el usuario") — mismo criterio de gateo que subirlo.
describe('DELETE /laboratorio/:id/archivos', () => {
  it('AC: laboratorio.cargar alcanza para llegar al controller (404 en id inexistente)', async () => {
    const agent = await loginAs(SOLO_CARGAR);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.delete('/laboratorio/999999/archivos').set('x-csrf-token', csrfToken);

    expect(res.status).toBe(404);
  });

  it('un usuario sin laboratorio.cargar es rebotado a /main.html (aunque tenga laboratorio.ver)', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.delete('/laboratorio/999999/archivos').set('x-csrf-token', csrfToken);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

describe('DELETE /laboratorio/:id/estudios/:estudioId/archivo', () => {
  it('AC: laboratorio.cargar alcanza para llegar al controller (404 en id inexistente)', async () => {
    const agent = await loginAs(SOLO_CARGAR);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent
      .delete('/laboratorio/999999/estudios/1/archivo')
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(404);
  });

  it('un usuario sin laboratorio.cargar es rebotado a /main.html', async () => {
    const agent = await loginAs(SOLO_VER);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent
      .delete('/laboratorio/999999/estudios/1/archivo')
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

// Envío real de resultados (pedido explícito del usuario) — permiso PROPIO
// `laboratorio.enviar`, distinto de `laboratorio.cargar` (alguien que solo
// carga archivos no necesariamente debe poder disparar el envío al
// tutor). Con un id inexistente, el service nunca llega a intentar
// correo/WhatsApp de verdad (falla antes, en el 404) — mismo criterio que
// el resto de este archivo: sin datos reales, la cobertura del envío en sí
// vive en laboratorio.envios.test.js/laboratorio.service.test.js.
describe('POST /laboratorio/:id/enviar', () => {
  it('AC: laboratorio.enviar alcanza para llegar al controller (404 en id inexistente)', async () => {
    const agent = await loginAs(SOLO_ENVIAR);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio/999999/enviar').set('x-csrf-token', csrfToken);

    expect(res.status).toBe(404);
  });

  it('tener laboratorio.cargar no alcanza — hace falta laboratorio.enviar', async () => {
    const agent = await loginAs(SOLO_CARGAR);
    const csrfToken = await getLaboratorioCsrfToken(agent);

    const res = await agent.post('/laboratorio/999999/enviar').set('x-csrf-token', csrfToken);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });
});

// Descarga autenticada — nunca por static serving directo (ver comentario
// del .gitignore); laboratorio.ver alcanza (igual que abrir /ver), no
// hace falta laboratorio.cargar para descargar un resultado ya subido.
describe('GET /laboratorio/archivos/:archivoId', () => {
  it('AC: laboratorio.ver alcanza para llegar al controller (404 en id inexistente)', async () => {
    const agent = await loginAs(SOLO_VER);

    const res = await agent.get('/laboratorio/archivos/999999');

    expect(res.status).toBe(404);
  });

  it('un usuario sin laboratorio.ver es rebotado a /main.html', async () => {
    const agent = await loginAs(SIN_PERMISOS);

    const res = await agent.get('/laboratorio/archivos/999999');

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
