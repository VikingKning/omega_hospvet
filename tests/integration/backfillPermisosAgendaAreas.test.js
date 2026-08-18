// Auto-provisión de permisos de agenda: un área creada ANTES de que
// existiera areas.repository.js#asegurarPermisosAgenda pudo quedar sin sus
// 5 permisos `agenda_<slug>.<accion>` para siempre. Este archivo prueba
// DIRECTAMENTE la función up() de la migración de datos
// (20260817000002_backfill_permisos_agenda_areas_existentes.js) — las
// migraciones de Knex son funciones planas (up(knex)), invocables fuera
// del CLI; la migración real ya corrió una sola vez, este test la vuelve a
// invocar directo para verificar su lógica, no para "correr la migración"
// otra vez de verdad.
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');
const migracion = require('../../src/db/migrations/20260817000002_backfill_permisos_agenda_areas_existentes');

const SLUG = 'huerfana-backfill-test';

async function cleanup() {
  await db('permissions').where('modulo', `agenda_${SLUG}`).del();
  await db('areas').where('slug', SLUG).del();
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await Promise.all([db.destroy(), sessionStore.close()]);
});

describe('Migración 20260817000002: backfill de permisos de agenda para áreas ya existentes', () => {
  it('AC: un área sin permisos de agenda los recibe tras correr la migración', async () => {
    await db('areas').insert({
      nombre: 'Huérfana Backfill Test',
      slug: SLUG,
      activo: true,
      creado_en: db.fn.now(),
    });

    await migracion.up(db);

    const permisos = await db('permissions')
      .where('modulo', `agenda_${SLUG}`)
      .orderBy('accion')
      .select('accion', 'codigo', 'descripcion');
    expect(permisos).toHaveLength(5);
    expect(permisos.find((p) => p.accion === 'ver').codigo).toBe(`agenda.${SLUG}.ver`);
  });

  it('es idempotente: correrla dos veces no duplica filas ni truena', async () => {
    await migracion.up(db);
    await migracion.up(db);

    const permisos = await db('permissions').where('modulo', `agenda_${SLUG}`);
    expect(permisos).toHaveLength(5);
  });

  it('cubre también áreas inactivas (dadas de baja antes de tener sus permisos)', async () => {
    await cleanup();
    await db('areas').insert({
      nombre: 'Huérfana Backfill Test',
      slug: SLUG,
      activo: false,
      creado_en: db.fn.now(),
    });

    await migracion.up(db);

    const permisos = await db('permissions').where('modulo', `agenda_${SLUG}`);
    expect(permisos).toHaveLength(5);
  });
});
