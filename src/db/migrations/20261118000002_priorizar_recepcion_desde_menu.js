exports.up = async function up(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.timestamp('menu_principal_vigente_en', { useTz: true });
    table.timestamp('recepcion_prioritaria_en', { useTz: true });
  });
  // Conserva los menús que ya estaban esperando selección al actualizar.
  await knex('conversaciones_whatsapp')
    .where({ estado: 'esperando_menu' })
    .whereNull('flujo_actual')
    .update({ menu_principal_vigente_en: knex.ref('ultima_interaccion_en') });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.dropColumn('menu_principal_vigente_en');
    table.dropColumn('recepcion_prioritaria_en');
  });
};
