const permissions = [
  ['agenda', 'ver', 'Ver la agenda de consultas y cirugías'],
  ['agenda', 'crear', 'Agendar una nueva cita de consulta o cirugía'],
  ['agenda', 'confirmar', 'Confirmar una cita de consulta o cirugía'],
  ['agenda', 'cancelar', 'Cancelar una cita de consulta o cirugía'],
  ['agenda', 'editar', 'Editar una cita de consulta o cirugía existente'],

  ['grooming', 'ver', 'Ver la agenda de grooming'],
  ['grooming', 'crear', 'Agendar una nueva cita de grooming'],
  ['grooming', 'confirmar', 'Confirmar una cita de grooming'],
  ['grooming', 'cancelar', 'Cancelar una cita de grooming'],
  ['grooming', 'editar', 'Editar una cita de grooming existente'],

  ['laboratorio', 'ver', 'Ver órdenes de laboratorio'],
  ['laboratorio', 'crear', 'Dar de alta una orden de laboratorio'],
  ['laboratorio', 'cargar', 'Cargar archivos de resultados de laboratorio'],
  ['laboratorio', 'enviar', 'Enviar resultados de laboratorio al tutor'],
  ['laboratorio', 'eliminar', 'Eliminar una orden de laboratorio'],

  ['usuarios', 'ver', 'Ver el listado de usuarios del panel'],
  ['usuarios', 'crear', 'Crear un nuevo usuario del panel'],
  ['usuarios', 'editar', 'Editar los datos de un usuario del panel'],
  ['usuarios', 'eliminar', 'Dar de baja (desactivar) un usuario del panel'],
  ['usuarios', 'permisos', 'Otorgar o revocar permisos de un usuario'],
  ['usuarios', 'resetear_password', 'Resetear la contraseña de un usuario'],

  ['doctores', 'ver', 'Ver el catálogo de doctores'],
  ['doctores', 'crear', 'Crear un doctor nuevo'],
  ['doctores', 'editar', 'Editar un doctor existente'],
  ['doctores', 'eliminar', 'Eliminar (dar de baja) un doctor'],

  ['areas', 'ver', 'Ver el catálogo de áreas'],
  ['areas', 'crear', 'Crear un área nueva'],
  ['areas', 'editar', 'Editar un área existente'],
  ['areas', 'eliminar', 'Eliminar (dar de baja) un área'],

  ['plantillas', 'ver', 'Ver las plantillas de respuesta de WhatsApp'],
  ['plantillas', 'crear', 'Crear una plantilla de respuesta de WhatsApp'],
  ['plantillas', 'editar', 'Editar una plantilla de respuesta de WhatsApp'],
  ['plantillas', 'eliminar', 'Eliminar (dar de baja) una plantilla de respuesta de WhatsApp'],

  ['metricas', 'ver', 'Ver el panel de métricas'],
];

exports.seed = async function seed(knex) {
  await knex('usuario_permisos').del();
  await knex('permissions').del();

  await knex('permissions').insert(
    permissions.map(([modulo, accion, descripcion]) => ({
      modulo,
      accion,
      codigo: `${modulo}.${accion}`,
      descripcion,
    })),
  );
};
