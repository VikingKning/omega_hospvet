// Pedido explícito del usuario: la pantalla completa de "Nuevo registro de
// laboratorio" (mockup HTML compartido) trae "Observaciones generales" a
// nivel de la orden completa y "Observaciones del estudio" por cada estudio
// agregado — ninguna de las dos existe hoy. AVISO EXPLÍCITO: esto se desvía
// del schema original del cliente (assets/sql/Omega-Database.sql no las
// define), mismo criterio ya aplicado en migraciones anteriores de esta
// sesión (campo_adicional, sexo/anio_nacimiento). Ambas nullable — texto
// libre opcional, no todos los registros van a traer algo capturado.
exports.up = function up(knex) {
  return Promise.all([
    knex.schema.alterTable('registros_laboratorio', (table) => {
      table.text('observaciones');
    }),
    knex.schema.alterTable('estudios_solicitados', (table) => {
      table.text('observaciones');
    }),
  ]);
};

exports.down = function down(knex) {
  return Promise.all([
    knex.schema.alterTable('registros_laboratorio', (table) => {
      table.dropColumn('observaciones');
    }),
    knex.schema.alterTable('estudios_solicitados', (table) => {
      table.dropColumn('observaciones');
    }),
  ]);
};
