// Pedido explícito del usuario: tener referenciado en algún lado qué
// categoría de Meta usa cada plantilla (Marketing/Utility/Authentication)
// — hoy TODO el registro real en Meta manda 'UTILITY' fijo (ver
// plantillas_whatsapp.service.js y scripts/registrar-plantillas-
// whatsapp.js/registrar-plantilla-resultados-laboratorio.js), así que el
// default de esta columna coincide con lo que de verdad se manda. Por
// ahora es puramente informativa (se muestra en el detalle de solo
// lectura, plantilla-detalle.ejs) — decisión explícita del usuario:
// hacerla editable de verdad implicaría también cambiar el registro real
// en Meta, que es un cambio aparte.
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
