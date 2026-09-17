exports.up = function up(knex) {
  return knex.schema.alterTable('estudios_solicitados', (table) => {
    table.string('tipo_muestra', 100);
    table.boolean('antibiograma');
    table.string('tejido_origen', 200);
    table.string('lateralidad', 20);
    table.specificType('componentes_liquido', 'text[]');
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('estudios_solicitados', (table) => {
    table.dropColumn('tipo_muestra');
    table.dropColumn('antibiograma');
    table.dropColumn('tejido_origen');
    table.dropColumn('lateralidad');
    table.dropColumn('componentes_liquido');
  });
};
