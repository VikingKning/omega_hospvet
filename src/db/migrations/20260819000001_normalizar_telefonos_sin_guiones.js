exports.up = async function up(knex) {
  await knex.raw(`UPDATE propietarios SET telefono = regexp_replace(telefono, '\\D', '', 'g')`);
  await knex.raw(
    `UPDATE usuarios SET telefono = regexp_replace(telefono, '\\D', '', 'g') WHERE telefono IS NOT NULL`,
  );
};

exports.down = async function down(knex) {
  await knex.raw(`
    UPDATE propietarios
    SET telefono = substring(telefono from 1 for 2) || '-' || substring(telefono from 3 for 4) || '-' || substring(telefono from 7 for 4)
    WHERE telefono ~ '^[0-9]{10}$'
  `);
  await knex.raw(`
    UPDATE usuarios
    SET telefono = substring(telefono from 1 for 2) || '-' || substring(telefono from 3 for 4) || '-' || substring(telefono from 7 for 4)
    WHERE telefono ~ '^[0-9]{10}$'
  `);
};
