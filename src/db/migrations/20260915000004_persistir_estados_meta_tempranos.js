// US WA 015 AC3: conserva estados de entrega que lleguen antes de que el
// proceso que envio el mensaje alcance a guardar el wamid en el outbox.
exports.up = async function up(knex) {
  await knex.schema.createTable('estados_meta_whatsapp_pendientes', (table) => {
    table.string('wamid', 100).primary();
    table.string('estado_meta', 20).notNullable();
    table.timestamp('recibido_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX estados_meta_whatsapp_pendientes_recibido_idx
      ON estados_meta_whatsapp_pendientes (recibido_en);

    COMMENT ON TABLE "estados_meta_whatsapp_pendientes" IS 'Estados de entrega recibidos antes de asociar el wamid con outbox_whatsapp; se consumen al persistir dicha asociacion.';
  `);
};

exports.down = function down(knex) {
  return knex.schema.dropTable('estados_meta_whatsapp_pendientes');
};
