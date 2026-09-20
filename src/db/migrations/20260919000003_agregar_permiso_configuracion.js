exports.up = async function up(knex) {
  await knex('permissions')
    .insert({
      modulo: 'configuracion',
      accion: 'editar',
      codigo: 'configuracion.editar',
      descripcion: 'Editar la configuración general del sistema',
    })
    .onConflict('codigo')
    .ignore();
};

exports.down = async function down(knex) {
  await knex('permissions').where({ codigo: 'configuracion.editar' }).del();
};
