exports.up = async function up(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.dropColumn('requiere_zona');
    table.string('campo_adicional', 30);
  });
  await knex.raw(`
    COMMENT ON COLUMN "catalogo_estudios"."campo_adicional" IS 'zona | tipo_muestra | tejido_lateralidad | componentes_liquido | NULL (sin campo adicional)';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.dropColumn('campo_adicional');
    table.boolean('requiere_zona').notNullable().defaultTo(false);
  });
};
