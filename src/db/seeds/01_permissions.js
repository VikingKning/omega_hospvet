const permissions = [
  ['tutores', 'ver', 'Ver el catálogo de tutores y pacientes'],
  ['tutores', 'crear', 'Registrar un nuevo tutor y paciente'],
  ['tutores', 'editar', 'Editar los datos de un tutor y/o paciente'],
  ['tutores', 'eliminar', 'Eliminar (dar de baja) un tutor y/o paciente'],

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

  // US-604: se desdobla el antiguo `metricas.ver` único en un permiso por
  // cada sub-sección real del menú de Métricas (sidebar.ejs) — cada una es
  // su propio "módulo" en la matriz de permisos, con una sola acción "ver".
  // `codigo` explícito (`metricas.<seccion>.ver`, con puntos) pedido por el
  // usuario — no coincide con `${modulo}.${accion}` porque el módulo interno
  // sigue siendo `metricas_whatsapp` (con guion bajo) para la agrupación.
  ['metricas_whatsapp', 'ver', 'Ver métricas de WhatsApp', 'metricas.whatsapp.ver'],
  ['metricas_laboratorio', 'ver', 'Ver métricas de laboratorio', 'metricas.laboratorios.ver'],
  ['metricas_agenda', 'ver', 'Ver métricas de agenda', 'metricas.agenda.ver'],
];

// US-604 (tercera iteración): permisos granulares por categoría de agenda
// para el tab "Agendas" de la matriz de permisos de usuarios — un catálogo
// FIJO de 8 categorías (tipos de cita + especialidades médicas), cada una
// con las 5 acciones típicas de una agenda, pedido explícitamente por el
// usuario con la lista completa de códigos. A diferencia de `agenda`/
// `grooming` de arriba (que siguen existiendo, sin tocar, porque gatean
// las rutas reales /agenda.html y /grooming.html en app.js), estos son
// exclusivamente para la matriz de permisos — más granular, pero sin
// reemplazar el gate de acceso a la página. El `codigo` es explícito
// (`agenda.<categoria>.<accion>`, con puntos) en vez de derivarse de
// `modulo`/`accion` como el resto del catálogo — por eso viaja como un
// cuarto elemento en cada fila, distinto del criterio `${modulo}.${accion}`
// usado en todos los demás módulos.
const AGENDA_CATEGORIAS = [
  ['agenda_consultas', 'consultas', 'Consultas'],
  ['agenda_cirugias', 'cirugias', 'Cirugías'],
  ['agenda_grooming', 'grooming', 'Grooming'],
  ['agenda_cardiologia', 'cardiologia', 'Cardiología'],
  ['agenda_oftalmologia', 'oftalmologia', 'Oftalmología'],
  ['agenda_terapia', 'terapia', 'Terapia'],
  ['agenda_dermatologia', 'dermatologia', 'Dermatología'],
  ['agenda_neurologia', 'neurologia', 'Neurología'],
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
  await knex('usuario_permisos').del();
  await knex('permissions').del();

  await knex('permissions').insert(
    [...permissions, ...agendaPermissions].map(
      ([modulo, accion, descripcion, codigoExplicito]) => ({
        modulo,
        accion,
        codigo: codigoExplicito ?? `${modulo}.${accion}`,
        descripcion,
      }),
    ),
  );
};
