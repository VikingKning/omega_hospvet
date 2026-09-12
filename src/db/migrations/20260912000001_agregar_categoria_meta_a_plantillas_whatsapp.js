// Pedido explícito del usuario: tener referenciado en algún lado qué
// categoría de Meta usa cada plantilla (Marketing/Utility/Authentication)
// — hoy TODO el registro real en Meta manda 'UTILITY' fijo (ver
// plantillas_whatsapp.service.js y scripts/registrar-plantillas-
// whatsapp.js/registrar-plantilla-resultados-laboratorio.js), así que el
// default de esta columna coincide con lo que se solicita al registrar.
// Meta puede reclasificarla después; el job y el comando de consulta
// actualizan la columna con el valor real devuelto por su API.
exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.string('categoria_meta', 20).notNullable().defaultTo('UTILITY');
  });
  await knex.raw(
    `COMMENT ON COLUMN plantillas_whatsapp.categoria_meta IS 'Categoría de plantilla de Meta (MARKETING | UTILITY | AUTHENTICATION) — informativa, coincide con lo que de verdad se registra en Meta.'`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.dropColumn('categoria_meta');
  });
};
