// US-409 v2: garantías de BD que un repository mockeado no puede probar —
// el índice único parcial (archivos_laboratorio_hash_activo_unique) y el
// retiro en cascada dentro de una transacción real. Llama a
// laboratorio.repository.js directamente (sin HTTP/multipart) — mismo
// criterio que el resto de la suite de integración de este módulo: nunca
// uploads reales por HTTP, y NUNCA insertar en `doctores` (tabla
// compartida que doctores.test.js asume vacía) — aquí ni falta hace,
// registros_laboratorio.doctor_id es nullable, así que los registros de
// prueba se crean sin doctor.
const bcrypt = require('bcrypt');
const db = require('../../src/config/database');
const repository = require('../../src/modules/laboratorio/laboratorio.repository');

const SUFFIX = 'QA409ESTADO';

async function cleanup() {
  const registroIds = await db('registros_laboratorio as r')
    .join('mascotas as m', 'm.id', 'r.mascota_id')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .where('p.apellidos', 'like', `%${SUFFIX}%`)
    .pluck('r.id');
  if (registroIds.length) {
    // Orden importa: estudios_solicitados.archivo_id referencia
    // archivos_laboratorio — desvincular antes de poder borrar los
    // archivos, nunca al revés.
    await db('estudios_solicitados').whereIn('registro_laboratorio_id', registroIds).del();
    await db('archivos_laboratorio').whereIn('registro_laboratorio_id', registroIds).del();
    await db('registros_laboratorio').whereIn('id', registroIds).del();
  }

  const propietarioIds = await db('propietarios')
    .where('apellidos', 'like', `%${SUFFIX}%`)
    .pluck('id');
  if (propietarioIds.length) {
    await db('mascotas').whereIn('propietario_id', propietarioIds).del();
    await db('propietarios').whereIn('id', propietarioIds).del();
  }

  await db('usuarios').where('username', `usuario.${SUFFIX.toLowerCase()}`).del();
}

let usuarioId;
let mascotaId;
let estudioCatalogoId;

async function crearRegistroDePrueba() {
  const [{ id: registroId }] = await db('registros_laboratorio')
    .insert({
      mascota_id: mascotaId,
      doctor_id: null,
      fecha_solicitud: '2026-08-28',
      estado: 'pendiente',
      pendiente_desde: db.fn.now(),
      creado_por: usuarioId,
      creado_en: db.fn.now(),
    })
    .returning('id');
  const [{ id: estudioId }] = await db('estudios_solicitados')
    .insert({
      registro_laboratorio_id: registroId,
      estudio_id: estudioCatalogoId,
      estado: 'pendiente',
      creado_en: db.fn.now(),
    })
    .returning('id');
  return { registroId, estudioId };
}

function metadataDe(nombreOriginal, hashContenido) {
  return {
    nombreOriginal,
    rutaAlmacenamiento: `test/${hashContenido}.pdf`,
    hashContenido,
    tamanoBytes: 10,
    consolidado: false,
  };
}

beforeAll(async () => {
  await cleanup();

  const [{ id }] = await db('usuarios')
    .insert({
      nombre: 'QA',
      apellidos: SUFFIX,
      correo: `usuario.${SUFFIX.toLowerCase()}@omegavet.test`,
      username: `usuario.${SUFFIX.toLowerCase()}`,
      password_hash: await bcrypt.hash('Password123!', 4),
      creado_en: db.fn.now(),
    })
    .returning('id');
  usuarioId = id;

  const [{ id: propietarioId }] = await db('propietarios')
    .insert({
      nombre: 'Tutor',
      apellidos: SUFFIX,
      telefono: '5500000409',
      creado_en: db.fn.now(),
    })
    .returning('id');

  const [{ id: mascId }] = await db('mascotas')
    .insert({
      propietario_id: propietarioId,
      nombre: `Mascota ${SUFFIX}`,
      tipo: 'perro',
      creado_en: db.fn.now(),
    })
    .returning('id');
  mascotaId = mascId;

  const catalogoRow = await db('catalogo_estudios').first('id');
  estudioCatalogoId = catalogoRow.id;
});

afterAll(async () => {
  await cleanup();
  await db.destroy();
});

describe('US-409 v2: índice único parcial (BD real)', () => {
  it('un mismo hash activo en 2 registros distintos viola el índice único parcial', async () => {
    const { registroId: registroA } = await crearRegistroDePrueba();
    const { registroId: registroB } = await crearRegistroDePrueba();
    const hash = `hash-carrera-${Date.now()}`;

    await repository.registrarArchivoParaTodos({
      registroId: registroA,
      metadata: metadataDe('a.pdf', hash),
      usuarioId,
    });

    let errorCapturado;
    try {
      await repository.registrarArchivoParaTodos({
        registroId: registroB,
        metadata: metadataDe('b.pdf', hash),
        usuarioId,
      });
    } catch (err) {
      errorCapturado = err;
    }

    expect(errorCapturado).toBeDefined();
    expect(repository.esViolacionHashActivo(errorCapturado)).toBe(true);
  });

  it('retirar el archivo del registro A libera el hash para el registro B', async () => {
    const { registroId: registroA } = await crearRegistroDePrueba();
    const { registroId: registroB } = await crearRegistroDePrueba();
    const hash = `hash-liberado-${Date.now()}`;

    await repository.registrarArchivoParaTodos({
      registroId: registroA,
      metadata: metadataDe('a.pdf', hash),
      usuarioId,
    });

    await repository.desasignarArchivoDeTodosLosEstudios(registroA, usuarioId);

    const archivoIdB = await repository.registrarArchivoParaTodos({
      registroId: registroB,
      metadata: metadataDe('b.pdf', hash),
      usuarioId,
    });
    expect(archivoIdB).toBeGreaterThan(0);

    const activosDelHash = await repository.buscarArchivosActivosPorHashes([hash]);
    expect(activosDelHash).toHaveLength(1);
    expect(activosDelHash[0].registro_laboratorio_id).toBe(registroB);
  });

  it('retirar puebla retirado_por/retirado_en', async () => {
    const { registroId } = await crearRegistroDePrueba();
    const hash = `hash-auditoria-${Date.now()}`;

    const archivoId = await repository.registrarArchivoParaTodos({
      registroId,
      metadata: metadataDe('a.pdf', hash),
      usuarioId,
    });

    await repository.desasignarArchivoDeTodosLosEstudios(registroId, usuarioId);

    const archivo = await db('archivos_laboratorio').where({ id: archivoId }).first();
    expect(archivo.estado).toBe('retirado');
    expect(archivo.retirado_por).toBe(usuarioId);
    expect(archivo.retirado_en).not.toBeNull();
  });

  it('"Reemplazar" (registrarArchivoParaTodos sobre un registro que ya tenía uno activo) retira el archivo viejo', async () => {
    const { registroId } = await crearRegistroDePrueba();

    const archivoViejoId = await repository.registrarArchivoParaTodos({
      registroId,
      metadata: metadataDe('viejo.pdf', `hash-viejo-${Date.now()}`),
      usuarioId,
    });
    const archivoNuevoId = await repository.registrarArchivoParaTodos({
      registroId,
      metadata: metadataDe('nuevo.pdf', `hash-nuevo-${Date.now()}`),
      usuarioId,
    });

    const viejo = await db('archivos_laboratorio').where({ id: archivoViejoId }).first();
    expect(viejo.estado).toBe('retirado');
    expect(viejo.retirado_por).toBe(usuarioId);

    const nuevo = await db('archivos_laboratorio').where({ id: archivoNuevoId }).first();
    expect(nuevo.estado).toBe('cargado');
  });
});
