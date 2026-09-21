// Pedido explícito del usuario (2026-09-21): al aceptar el aviso, retomar
// justo lo que el tutor había escrito antes de que el gate lo interceptara
// — para que no tenga que volver a escribirlo. Este campo referencia esa
// fila (que, solo para el caso "necesita_preguntar", SÍ guarda el
// contenido real — ver whatsapp.repository.js#procesarConsentimientoLfpdppp).
exports.up = async function up(knex) {
  await knex.schema.alterTable('consentimiento_lfpdppp', (table) => {
    table
      .integer('mensaje_pendiente_id')
      .nullable()
      .references('id')
      .inTable('mensajes_whatsapp')
      .onDelete('SET NULL');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('consentimiento_lfpdppp', (table) => {
    table.dropColumn('mensaje_pendiente_id');
  });
};
