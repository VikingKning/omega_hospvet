const NOMBRE = 'Consultas Omega';
const APELLIDOS = 'Generico';

exports.up = async function up(knex) {
  await knex.schema.alterTable('doctores', (table) => {
    table.boolean('es_predeterminado').notNullable().defaultTo(false);
  });
  await knex.raw(`
    COMMENT ON COLUMN doctores.es_predeterminado IS
      'Doctor protegido del sistema (fallback de Consultas): nunca se edita/renombra ni se da de baja — mismo criterio que areas.es_predeterminada.'
  `);

  const [doctor] = await knex('doctores')
    .where({ nombre: NOMBRE, apellidos: APELLIDOS })
    .update({ es_predeterminado: true })
    .returning('id');
  if (!doctor) return;

  const area = await knex('areas').where({ slug: 'consultas' }).first('id');
  if (area) {
    await knex('doctor_area')
      .insert({ doctor_id: doctor.id, area_id: area.id })
      .onConflict(['doctor_id', 'area_id'])
      .ignore();
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('doctores', (table) => {
    table.dropColumn('es_predeterminado');
  });
};
