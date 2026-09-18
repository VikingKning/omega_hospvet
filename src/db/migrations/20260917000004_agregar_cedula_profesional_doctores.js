exports.up = async function up(knex) {
  await knex.schema.alterTable('doctores', (table) => {
    table.string('cedula_profesional', 10).nullable().defaultTo(null);
  });

  await knex.raw(`
    ALTER TABLE doctores
      ADD CONSTRAINT doctores_cedula_profesional_check
      CHECK (
        cedula_profesional IS NULL
        OR cedula_profesional ~ '^[0-9]{7,10}$'
      );
  `);
};

exports.down = async function down(knex) {
  await knex.raw(
    'ALTER TABLE doctores DROP CONSTRAINT IF EXISTS doctores_cedula_profesional_check',
  );
  await knex.schema.alterTable('doctores', (table) => {
    table.dropColumn('cedula_profesional');
  });
};
