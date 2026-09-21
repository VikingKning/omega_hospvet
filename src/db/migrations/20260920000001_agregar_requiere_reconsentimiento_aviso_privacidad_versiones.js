// Switch "Reenviar a todos" en Configuración General: por default, aceptar
// una versión vieja del aviso sigue contando para siempre (correcto si el
// nuevo documento solo corrige formato). Cuando el cambio es material, el
// admin marca la versión vigente como "requiere reconsentimiento" y
// cualquiera cuyo último acepto no sea justo de ESTA versión vuelve a
// preguntarse en su siguiente interacción (ver evaluarEstado) — sin borrar
// ni tocar los registros de aceptación anteriores.
exports.up = async function up(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.boolean('requiere_reconsentimiento').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.dropColumn('requiere_reconsentimiento');
  });
};
