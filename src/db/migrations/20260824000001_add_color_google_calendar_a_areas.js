exports.up = function up(knex) {
  return knex.schema.alterTable('areas', (table) => {
    table.string('color_google_calendar', 2);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('areas', (table) => {
    table.dropColumn('color_google_calendar');
  });
};
