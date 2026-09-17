exports.up = async function up(knex) {
  await knex.schema.alterTable('propietarios', (table) => {
    table.string('apellidos', 150);
  });

  await knex.raw(`
    UPDATE propietarios
    SET apellidos = CASE WHEN position(' ' in nombre) > 0
          THEN trim(substring(nombre from position(' ' in nombre) + 1))
          ELSE '' END,
        nombre = split_part(nombre, ' ', 1)
  `);

  await knex.schema.alterTable('propietarios', (table) => {
    table.string('apellidos', 150).notNullable().alter();
  });
};

exports.down = async function down(knex) {
  await knex.raw(`UPDATE propietarios SET nombre = trim(nombre || ' ' || apellidos)`);
  await knex.schema.alterTable('propietarios', (table) => {
    table.dropColumn('apellidos');
  });
};
