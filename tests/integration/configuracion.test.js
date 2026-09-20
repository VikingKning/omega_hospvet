// Configuración General del sistema — módulo nuevo para LFPDPPP: permite
// cargar el aviso de privacidad que luego usa el gate de consentimiento de
// WhatsApp. Mismo patrón de permisos/tests que areas.test.js.
//
// Cada carga es una versión nueva (nunca se sobreescribe el archivo
// anterior): un tutor pudo haber aceptado una versión vieja del aviso, y
// esa evidencia solo es verificable si el PDF vigente en ese momento sigue
// existiendo (pedido explícito del usuario, 2026-09-19).
const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');
const configuracionRepository = require('../../src/modules/configuracion/configuracion.repository');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SIN_PERMISOS_USER = { username: 'sin.permisos.config.test', password: 'SinPermisosTest123!' };
const SUFFIX = 'QACONFIG';

const DIRECTORIO_LEGAL = path.join(__dirname, '../../public/legal');

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

async function getConfiguracionCsrfToken(agent) {
  const res = await agent.get('/configuracion/generales.html');
  const match = res.text.match(/x-csrf-token":\s*"([^"]+)"/);
  return match[1];
}

async function subirAviso(agent, { version, filename, contenido }) {
  const csrfToken = await getConfiguracionCsrfToken(agent);
  return agent
    .post('/configuracion/generales.html')
    .set('x-csrf-token', csrfToken)
    .field('version', version ?? '')
    .attach('archivo', Buffer.from(contenido), { filename, contentType: 'application/pdf' });
}

async function archivoVigente() {
  const [archivo] = await configuracionRepository.obtenerValores(['aviso_privacidad_archivo']);
  return archivo?.valor ?? null;
}

async function limpiarArchivosVersionesDePrueba() {
  const versiones = await db('aviso_privacidad_versiones').select('nombre_archivo');
  await Promise.all(
    versiones.map((v) => fs.rm(path.join(DIRECTORIO_LEGAL, v.nombre_archivo), { force: true })),
  );
  await db('aviso_privacidad_versiones').del();
}

async function cleanup() {
  await db('configuracion_sistema').where('clave', 'like', 'aviso_privacidad_%').del();
  await limpiarArchivosVersionesDePrueba();
  const usuarioIds = await db('usuarios').where('username', SIN_PERMISOS_USER.username).pluck('id');
  if (usuarioIds.length) {
    await db('usuario_permisos').whereIn('usuario_id', usuarioIds).del();
    await db('usuarios').whereIn('id', usuarioIds).del();
  }
}

beforeAll(async () => {
  await cleanup();
  await db('usuarios').insert({
    nombre: 'Test',
    apellidos: SUFFIX,
    correo: `${SIN_PERMISOS_USER.username}@omegavet.test`,
    username: SIN_PERMISOS_USER.username,
    password_hash: await bcrypt.hash(SIN_PERMISOS_USER.password, 4),
    creado_en: db.fn.now(),
  });
});

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('GET /configuracion/generales.html', () => {
  it('un usuario sin configuracion.editar no puede entrar', async () => {
    const agent = await loginAs(SIN_PERMISOS_USER);

    const res = await agent.get('/configuracion/generales.html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/main.html');
  });

  it('el admin ve el formulario y, sin aviso configurado, el mensaje de "aún no hay archivo"', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await agent.get('/configuracion/generales.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Todavía no se ha cargado un aviso de privacidad');
  });
});

describe('POST /configuracion/generales.html', () => {
  it('rechaza un archivo que no es PDF', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const csrfToken = await getConfiguracionCsrfToken(agent);

    const res = await agent
      .post('/configuracion/generales.html')
      .set('x-csrf-token', csrfToken)
      .field('version', '')
      .attach('archivo', Buffer.from('no es un pdf'), {
        filename: 'aviso.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('debe ser un archivo PDF');
  });

  it('guarda el PDF en disco y persiste clave/valor, usando la fecha de hoy si no se da versión', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const res = await subirAviso(agent, {
      filename: 'Aviso de Privacidad Omega.pdf',
      contenido: '%PDF-1.4 contenido de prueba',
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Aviso de privacidad actualizado correctamente');
    expect(res.text).toContain('Aviso de Privacidad Omega.pdf');

    const archivo = await archivoVigente();
    const contenidoEnDisco = await fs.readFile(path.join(DIRECTORIO_LEGAL, archivo), 'utf8');
    expect(contenidoEnDisco).toBe('%PDF-1.4 contenido de prueba');

    const [version] = await configuracionRepository.obtenerValores(['aviso_privacidad_version']);
    expect(version.valor).toBe(new Date().toISOString().slice(0, 10));
  });

  it('un nombre con guion largo u otro carácter especial no se corrompe (bug de multer/busboy con latin1)', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    const nombreConGuionLargo = 'Aviso de Privacidad — Omega (WhatsApp).pdf';

    const res = await subirAviso(agent, {
      filename: nombreConGuionLargo,
      contenido: '%PDF-1.4 contenido de prueba',
    });

    expect(res.text).toContain(nombreConGuionLargo);
    expect(res.text).not.toContain('â');
  });

  it('una carga nueva NO borra la anterior: ambos PDFs siguen en disco y el listado trae las 2 versiones', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    await subirAviso(agent, {
      version: 'v1.0',
      filename: 'v1.pdf',
      contenido: '%PDF-1.4 version uno',
    });
    const archivoV1 = await archivoVigente();

    const res = await subirAviso(agent, {
      version: 'v2.0',
      filename: 'v2.pdf',
      contenido: '%PDF-1.4 version dos',
    });
    const archivoV2 = await archivoVigente();

    expect(archivoV2).not.toBe(archivoV1);
    expect(await fs.readFile(path.join(DIRECTORIO_LEGAL, archivoV1), 'utf8')).toBe(
      '%PDF-1.4 version uno',
    );
    expect(await fs.readFile(path.join(DIRECTORIO_LEGAL, archivoV2), 'utf8')).toBe(
      '%PDF-1.4 version dos',
    );

    // La vigente (v2.0) se marca como tal en la tabla que ve el admin.
    expect(res.text).toContain('v2.0 (vigente)');
    expect(res.text).toContain('v1.0');
    expect(res.text).not.toContain('v1.0 (vigente)');
  });

  it('el listado de últimas versiones no muestra más de 5, aunque haya más cargadas', async () => {
    const agent = await loginAs({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    for (let i = 1; i <= 6; i++) {
      await subirAviso(agent, {
        version: `v${i}.0`,
        filename: `v${i}.pdf`,
        contenido: `%PDF-1.4 version ${i}`,
      });
    }

    const res = await agent.get('/configuracion/generales.html');

    expect(res.text).toContain('v6.0 (vigente)');
    // "v1.0" también aparece en el placeholder estático del input de
    // versión, por eso se verifica contra el nombre de archivo (único).
    expect(res.text).not.toContain('v1.pdf'); // la más vieja, ya fuera del top 5
    const versiones = await db('aviso_privacidad_versiones').select('id');
    expect(versiones).toHaveLength(6); // en BD sí se conservan todas
  });
});
