const permissions = [
  ['tutores', 'ver', 'Ver el catálogo de tutores y pacientes'],
  ['tutores', 'crear', 'Registrar un nuevo tutor y paciente'],
  ['tutores', 'editar', 'Editar los datos de un tutor y/o paciente'],
  ['tutores', 'eliminar', 'Eliminar (dar de baja) un tutor y/o paciente'],

  ['laboratorio', 'ver', 'Ver órdenes de laboratorio'],
  ['laboratorio', 'crear', 'Dar de alta una orden de laboratorio'],
  ['laboratorio', 'editar', 'Editar una orden de laboratorio existente'],
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

  ['metricas_whatsapp', 'ver', 'Ver métricas de WhatsApp', 'metricas.whatsapp.ver'],
  ['metricas_laboratorio', 'ver', 'Ver métricas de laboratorio', 'metricas.laboratorios.ver'],
  ['metricas_agenda', 'ver', 'Ver métricas de agenda', 'metricas.agenda.ver'],

  ['configuracion', 'editar', 'Editar la configuración general del sistema'],
];

const AGENDA_CATEGORIAS = [
  ['agenda_consultas', 'consultas', 'Consultas'],
  ['agenda_estetica', 'estetica', 'Estética'],
];
const AGENDA_ACCIONES = [
  ['ver', 'Ver'],
  ['crear', 'Agendar'],
  ['editar', 'Editar'],
  ['cancelar', 'Cancelar'],
  ['confirmar', 'Confirmar'],
];
const agendaPermissions = AGENDA_CATEGORIAS.flatMap(([modulo, slug, nombre]) =>
  AGENDA_ACCIONES.map(([accion, accionLabel]) => [
    modulo,
    accion,
    `${accionLabel} citas de ${nombre}`,
    `agenda.${slug}.${accion}`,
  ]),
);

exports.seed = async function seed(knex) {
  const filas = [...permissions, ...agendaPermissions].map(
    ([modulo, accion, descripcion, codigoExplicito]) => ({
      modulo,
      accion,
      codigo: codigoExplicito ?? `${modulo}.${accion}`,
      descripcion,
    }),
  );

  await knex('permissions')
    .insert(filas)
    .onConflict('codigo')
    .merge(['modulo', 'accion', 'descripcion']);
};

exports.PERMISSIONS = permissions;
exports.AGENDA_CATEGORIAS = AGENDA_CATEGORIAS;
