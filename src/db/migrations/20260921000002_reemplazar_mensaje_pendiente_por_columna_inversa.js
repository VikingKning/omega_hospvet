// Reemplaza consentimiento_lfpdppp.mensaje_pendiente_id (un solo mensaje)
// por mensajes_whatsapp.consentimiento_pendiente_id (muchos mensajes por
// episodio) — bug real visto en vivo 2026-09-21: si el tutor escribía por
// partes mientras el gate lo interceptaba, solo el PRIMER fragmento se
// retenía; al aceptar, se perdían los demás (ver
// whatsapp.repository.js#procesarConsentimientoLfpdppp). Con la FK invertida
// se pueden vincular todos los mensajes retenidos de un mismo episodio y
// reproducirlos juntos, en orden, al aceptar.
//
// También habilita el borrado físico si el tutor RECHAZA (pedido explícito
// del usuario, 2026-09-21): no se guarda información de personas que no
// aceptaron el aviso de privacidad — al rechazar, se hace DELETE de los
// mensajes_whatsapp ligados a ese consentimiento_pendiente_id.
exports.up = async function up(knex) {
  await knex.schema.alterTable('consentimiento_lfpdppp', (table) => {
    table.dropColumn('mensaje_pendiente_id');
  });
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table
      .integer('consentimiento_pendiente_id')
      .nullable()
      .references('id')
      .inTable('consentimiento_lfpdppp')
      .onDelete('SET NULL');
    table.index('consentimiento_pendiente_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.dropColumn('consentimiento_pendiente_id');
  });
  await knex.schema.alterTable('consentimiento_lfpdppp', (table) => {
    table
      .integer('mensaje_pendiente_id')
      .nullable()
      .references('id')
      .inTable('mensajes_whatsapp')
      .onDelete('SET NULL');
  });
};
