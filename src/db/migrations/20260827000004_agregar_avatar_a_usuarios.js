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
