// US WA 017: los 2 nuevos valores de resultado técnico que esta historia
// agrega a mensajes_whatsapp.estado_procesamiento —
// 'ignorado_atencion_humana' (AC8) y 'comando_reactivacion_bot' (AC13) —
// miden 24 caracteres cada uno, más que el varchar(20) original (US WA
// 001). Se amplía a 30 para igualar el ancho ya usado por columnas
// hermanas del mismo estilo (tipo_mensaje, origen_funcional) y dejar
// margen sin tener que volver a tocar esto por un valor futuro parecido.
exports.up = async function up(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.string('estado_procesamiento', 30).notNullable().defaultTo('pendiente').alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.string('estado_procesamiento', 20).notNullable().defaultTo('pendiente').alter();
  });
};
