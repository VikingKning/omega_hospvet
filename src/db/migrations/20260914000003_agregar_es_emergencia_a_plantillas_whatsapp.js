exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.boolean('es_emergencia').notNullable().defaultTo(false);
  });
  await knex.raw(`
    COMMENT ON COLUMN plantillas_whatsapp.es_emergencia IS
      'Marca si esta plantilla es la respuesta a una emergencia médica — para identificar si el slug que regresó el LLM corresponde a una emergencia.'
  `);
  await knex('plantillas_whatsapp')
    .where({ slug: 'emergencia-medica' })
    .update({ es_emergencia: true });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.dropColumn('es_emergencia');
  });
};
