exports.up = async function up(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.string('especie', 10);
  });
  await knex.raw(`
    COMMENT ON COLUMN "catalogo_estudios"."especie" IS 'Perro | Gato | NULL (aplica a ambas especies)';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.dropColumn('especie');
  });
};
