// Pedido explícito del usuario: cada usuario elige uno de 5 íconos fijos
// para mostrarse en la barra de título (ver perfil.ejs, sección "Datos
// personales") — se guarda el nombre base del archivo en assets/imgs
// (sin extensión), nunca la ruta completa. AVISO EXPLÍCITO: esto se
// desvía del schema original del cliente (assets/sql/Omega-Database.sql
// no tiene esta columna) — mismo criterio ya aplicado para
// catalogo_estudios.especie/campo_adicional. Default 'icon_hospvet'
// (pedido explícito del usuario) — todas las filas existentes quedan con
// ese valor sin necesitar un backfill aparte, gracias al `defaultTo` a
// nivel de columna.
exports.up = async function up(knex) {
  await knex.schema.alterTable('usuarios', (table) => {
    table.string('avatar', 30).notNullable().defaultTo('icon_hospvet');
  });
  await knex.raw(`
    COMMENT ON COLUMN "usuarios"."avatar" IS 'icon_hospvet | icon_cat | icon_dog | img_doctor | img_doctora';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('usuarios', (table) => {
    table.dropColumn('avatar');
  });
};
