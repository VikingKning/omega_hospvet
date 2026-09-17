exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.string('categoria_meta', 20).notNullable().defaultTo('UTILITY');
  });
  await knex.raw(
    `COMMENT ON COLUMN plantillas_whatsapp.categoria_meta IS 'Categoría de plantilla de Meta (MARKETING | UTILITY | AUTHENTICATION) — informativa, coincide con lo que de verdad se registra en Meta.'`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.dropColumn('categoria_meta');
  });
};
