// Guardan el valor real del campo adicional que pidió el estudio elegido
// (ver catalogo_estudios.campo_adicional, migración anterior) — columnas
// explícitas tipadas, no un JSON genérico (decisión explícita del usuario,
// mismo estilo que el resto del schema). Todas NULLABLE: cada fila de
// estudios_solicitados solo llena la que le corresponde según su estudio;
// laboratorio.service.js exige la correcta al crear, nunca aquí a nivel BD
// (mismo criterio que el resto del proyecto: reglas de negocio en el
// service, no CHECK constraints).
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
