const ACCIONES_AGENDA = [
  ['ver', 'Ver'],
  ['crear', 'Agendar'],
  ['editar', 'Editar'],
  ['cancelar', 'Cancelar'],
  ['confirmar', 'Confirmar'],
];

async function renombrar(knex, nombre) {
  // El slug y los IDs son los vínculos de citas, permisos y reservas.
  // Solo se actualizan etiquetas, conservando estados y auditoría.
  await knex('areas').where({ slug: 'consultas' }).update({ nombre });

  for (const [accion, etiqueta] of ACCIONES_AGENDA) {
    await knex('permissions')
      .where({ codigo: `agenda.consultas.${accion}` })
      .update({ descripcion: `${etiqueta} citas de ${nombre}` });
  }

  await knex('configuracion_funciones')
    .where({ clave: 'whatsapp_citas_consultas' })
    .update({
      nombre: `Citas de ${nombre}`,
      descripcion: `Permite ofrecer el flujo de citas para ${nombre} por WhatsApp.`,
    });
}

exports.up = async function up(knex) {
  await renombrar(knex, 'Servicios a Domicilio');
};

exports.down = async function down(knex) {
  await renombrar(knex, 'Consultas Domicilio');
};
