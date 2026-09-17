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
