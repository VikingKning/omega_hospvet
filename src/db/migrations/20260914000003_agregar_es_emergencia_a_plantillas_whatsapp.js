// Pedido explícito del usuario: switch en el formulario de plantillas para
// marcar si esa plantilla responde a una emergencia médica — pensado para
// identificar si el slug que el LLM regresó (whatsapp.service.js) es una
// emergencia, sin necesidad de comparar contra un slug fijo hardcodeado.
// La plantilla predeterminada del sistema 'emergencia-medica' (migración
// 20260903000002_agregar_plantillas_predeterminadas.js) es la respuesta
// real a una emergencia — pedido explícito del usuario (ajuste posterior):
// se marca es_emergencia=true en esta misma migración. El resto del
// catálogo sigue en false por default; el usuario decide manualmente
// cuáles otras activar desde el switch.
exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.boolean('es_emergencia').notNullable().defaultTo(false);
  });
  await knex.raw(`
    COMMENT ON COLUMN plantillas_whatsapp.es_emergencia IS
      'Marca si esta plantilla es la respuesta a una emergencia médica — para identificar si el slug que regresó el LLM corresponde a una emergencia.'
  `);
  await knex('plantillas_whatsapp')
    .where({ slug: 'emergencia-medica' })
    .update({ es_emergencia: true });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.dropColumn('es_emergencia');
  });
};
