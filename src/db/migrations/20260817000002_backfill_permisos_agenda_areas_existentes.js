const AGENDA_ACCIONES = [
  ['ver', 'Ver'],
  ['crear', 'Agendar'],
  ['editar', 'Editar'],
  ['cancelar', 'Cancelar'],
  ['confirmar', 'Confirmar'],
];

exports.up = async function up(knex) {
  const areas = await knex('areas').select('slug', 'nombre');
  if (!areas.length) return;

  const filas = areas.flatMap(({ slug, nombre }) =>
    AGENDA_ACCIONES.map(([accion, accionLabel]) => ({
      modulo: `agenda_${slug}`,
      accion,
      codigo: `agenda.${slug}.${accion}`,
      descripcion: `${accionLabel} citas de ${nombre}`,
    })),
  );

  await knex('permissions').insert(filas).onConflict('codigo').ignore();
};

exports.down = async function down() {};
