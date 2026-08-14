// US-106: reemplaza `usuarios.activo` (boolean) por `estatus` (4 valores) +
// `intentos_fallidos`/`bloqueado_en`, para soportar el bloqueo escalonado
// (15 min -> 30 min -> permanente) sin depender de un store en memoria que
// pierda el bloqueo permanente en cada reinicio del servidor. Espeja el
// cambio ya aplicado a mano por el cliente en `assets/sql/Omega-Database.sql`
// (la fuente de verdad del schema).
exports.up = async function up(knex) {
  await knex.schema.alterTable('usuarios', (table) => {
    table.string('estatus', 20).notNullable().defaultTo('activo');
    table.integer('intentos_fallidos').notNullable().defaultTo(0);
    table.timestamp('bloqueado_en', { useTz: true });
  });

  await knex.raw(
    `ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_estatus_check" CHECK ("estatus" IN ('activo', 'bloqueo_temp', 'bloqueado', 'inactivo'))`,
  );
  await knex.raw('CREATE INDEX ON "usuarios" ("estatus")');

  // Backfill: una cuenta desactivada (activo=false) pasa a estatus='inactivo'
  // (dada de baja por un admin) — no a 'bloqueado' (eso es exclusivo del
  // bloqueo automático por intentos fallidos, un concepto distinto).
  await knex('usuarios').where({ activo: false }).update({ estatus: 'inactivo' });

  await knex.schema.alterTable('usuarios', (table) => {
    table.dropColumn('activo');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('usuarios', (table) => {
    table.boolean('activo').notNullable().defaultTo(true);
  });

  await knex('usuarios').where({ estatus: 'inactivo' }).update({ activo: false });

  await knex.schema.alterTable('usuarios', (table) => {
    table.dropColumn('estatus');
    table.dropColumn('intentos_fallidos');
    table.dropColumn('bloqueado_en');
  });
};
