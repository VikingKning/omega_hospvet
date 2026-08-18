// Reconstrucción del menú: /agenda.html y /grooming.html pasan a
// protegerse con permisos granulares (agenda_<slug>.ver) en vez de los
// planos legacy (agenda.ver/grooming.ver). Este archivo prueba
// DIRECTAMENTE la función up() de la migración de datos
// (20260817000001_migrar_permisos_agenda_grooming_a_granulares.js) contra
// la base de test — las migraciones de Knex son funciones planas
// (up(knex)), perfectamente invocables fuera del CLI de migración; la
// migración real ya corrió una sola vez (knex_migrations la marca como
// aplicada), así que este test la vuelve a invocar directo para verificar
// su lógica de mapeo, no para "correr la migración" otra vez de verdad.
const bcrypt = require('bcrypt');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');
const migracion = require('../../src/db/migrations/20260817000001_migrar_permisos_agenda_grooming_a_granulares');

const USERNAME = 'migracion.agenda.test';

async function permisoId(modulo, accion) {
  const row = await db('permissions').where({ modulo, accion }).first('id');
  return row.id;
}

async function tienePermiso(usuarioId, permissionId) {
  const row = await db('usuario_permisos')
    .where({ usuario_id: usuarioId, permission_id: permissionId })
    .first('usuario_id');
  return Boolean(row);
}

async function cleanup() {
  const usuario = await db('usuarios').where({ username: USERNAME }).first('id');
  if (usuario) {
    await db('usuario_permisos').where({ usuario_id: usuario.id }).del();
    await db('usuarios').where({ id: usuario.id }).del();
  }
}

let usuarioId;

beforeAll(async () => {
  await cleanup();
  [usuarioId] = await db('usuarios')
    .insert({
      nombre: 'Migración',
      apellidos: 'Agenda Test',
      correo: `${USERNAME}@omegavet.test`,
      username: USERNAME,
      password_hash: await bcrypt.hash('MigracionAgendaTest12345678!', 4),
      creado_en: db.fn.now(),
    })
    .returning('id')
    .then(([row]) => [row.id]);
});

afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('Migración 20260817000001: agenda/grooming legacy -> permisos granulares', () => {
  it('otorgar agenda.ver (legacy) migra a agenda_consultas.ver Y agenda_cirugias.ver', async () => {
    const agendaVerId = await permisoId('agenda', 'ver');
    await db('usuario_permisos').insert({
      usuario_id: usuarioId,
      permission_id: agendaVerId,
      otorgado_por: usuarioId,
      otorgado_en: db.fn.now(),
    });

    await migracion.up(db);

    const consultasVerId = await permisoId('agenda_consultas', 'ver');
    const cirugiasVerId = await permisoId('agenda_cirugias', 'ver');
    expect(await tienePermiso(usuarioId, consultasVerId)).toBe(true);
    expect(await tienePermiso(usuarioId, cirugiasVerId)).toBe(true);
  });

  it('otorgar grooming.crear (legacy) migra a agenda_grooming.crear', async () => {
    const groomingCrearId = await permisoId('grooming', 'crear');
    await db('usuario_permisos').insert({
      usuario_id: usuarioId,
      permission_id: groomingCrearId,
      otorgado_por: usuarioId,
      otorgado_en: db.fn.now(),
    });

    await migracion.up(db);

    const agendaGroomingCrearId = await permisoId('agenda_grooming', 'crear');
    expect(await tienePermiso(usuarioId, agendaGroomingCrearId)).toBe(true);
  });

  it('es idempotente: correrla dos veces no crea filas duplicadas ni truena', async () => {
    await migracion.up(db);
    await migracion.up(db);

    const consultasVerId = await permisoId('agenda_consultas', 'ver');
    const filas = await db('usuario_permisos').where({
      usuario_id: usuarioId,
      permission_id: consultasVerId,
    });
    expect(filas).toHaveLength(1);
  });

  it('no toca los permisos legacy: siguen otorgados, no se borran', async () => {
    const agendaVerId = await permisoId('agenda', 'ver');
    expect(await tienePermiso(usuarioId, agendaVerId)).toBe(true);
  });

  it('un usuario sin ningún permiso legacy no gana permisos granulares de la nada', async () => {
    await cleanup();
    [usuarioId] = await db('usuarios')
      .insert({
        nombre: 'Migración',
        apellidos: 'Agenda Test',
        correo: `${USERNAME}@omegavet.test`,
        username: USERNAME,
        password_hash: await bcrypt.hash('MigracionAgendaTest12345678!', 4),
        creado_en: db.fn.now(),
      })
      .returning('id')
      .then(([row]) => [row.id]);

    await migracion.up(db);

    const consultasVerId = await permisoId('agenda_consultas', 'ver');
    expect(await tienePermiso(usuarioId, consultasVerId)).toBe(false);
  });
});
