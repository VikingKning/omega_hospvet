exports.up = async function up(knex) {
  await knex.schema.alterTable('citas', (table) => {
    table.integer('mascota_id').nullable().alter();
    table.integer('propietario_id');
  });

  await knex.raw(`
    COMMENT ON COLUMN "citas"."origen" IS 'portal | whatsapp | reserva_externa';
    COMMENT ON COLUMN "citas"."propietario_id" IS 'Solo se llena cuando mascota_id todavía no se puede determinar (reserva_externa) — normalmente el tutor se obtiene vía mascotas.propietario_id.';
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`COMMENT ON COLUMN "citas"."origen" IS 'portal | whatsapp'`);
  await knex.schema.alterTable('citas', (table) => {
    table.dropColumn('propietario_id');
    table.integer('mascota_id').notNullable().alter();
  });
};
