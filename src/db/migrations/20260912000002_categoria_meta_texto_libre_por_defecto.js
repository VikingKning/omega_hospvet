const SLUGS_REGISTRADAS_EN_META = [
  'resultados-laboratorio-listos',
  'resultados-laboratorio-listos-v2',
];

exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.string('categoria_meta', 20).notNullable().defaultTo('TEXTO_LIBRE').alter();
  });
  await knex('plantillas_whatsapp')
    .whereNotIn('slug', SLUGS_REGISTRADAS_EN_META)
    .update({ categoria_meta: 'TEXTO_LIBRE' });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.string('categoria_meta', 20).notNullable().defaultTo('UTILITY').alter();
  });
};
