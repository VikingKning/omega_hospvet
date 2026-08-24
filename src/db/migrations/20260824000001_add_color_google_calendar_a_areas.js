// Color de evento (Google Calendar `colorId`, valores '1'..'11', ver
// src/modules/areas/googleCalendarColors.js) que se usará al crear la cita
// en Google Calendar para esta área. Columna NULLABLE, sin default: NULL
// significa "Sin color" (pedido explícito del usuario como valor por
// defecto del picker), no un valor ausente/inválido — el service nunca
// tiene que inventar un color '1' por defecto para un área a la que nadie
// le eligió uno todavía. Los inserts directos a `areas` que no mandan este
// campo (seed 06_areas_agenda.js, varios tests de integración de otros
// módulos) simplemente quedan en NULL, sin tronar.
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
