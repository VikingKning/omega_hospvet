exports.up = async function up(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    // Meta valida un media_id subido por ~30 días — se cachea aquí para no
    // volver a subir el mismo PDF en cada solicitud de consentimiento nueva.
    table.string('media_id', 255).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.dropColumn('media_id');
  });
};
