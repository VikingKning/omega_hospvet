exports.up = async function up(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    // NULL en instalaciones anteriores: renovar en el primer envio, sin
    // atribuir a creado_en una fecha de subida a Meta que no conocemos.
    table.timestamp('media_subido_en', { useTz: true }).nullable();
  });
  await knex.schema.createTable('control_envios_aviso_privacidad', (table) => {
    table.string('telefono', 20).notNullable();
    table.string('version_aviso', 50).notNullable();
    table.timestamp('ultimo_intento_en', { useTz: true }).notNullable();
    table.primary(['telefono', 'version_aviso']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('control_envios_aviso_privacidad');
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.dropColumn('media_subido_en');
  });
};
