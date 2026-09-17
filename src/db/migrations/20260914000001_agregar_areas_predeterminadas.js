const AREAS_PREDETERMINADAS = [
  { nombre: 'Consultas', slug: 'consultas' },
  { nombre: 'Estética', slug: 'estetica' },
];

const AGENDA_ACCIONES = [
  ['ver', 'Ver'],
  ['crear', 'Agendar'],
  ['editar', 'Editar'],
  ['cancelar', 'Cancelar'],
  ['confirmar', 'Confirmar'],
];

exports.up = async function up(knex) {
  await knex.schema.alterTable('areas', (table) => {
    table.boolean('es_predeterminada').notNullable().defaultTo(false);
  });
  await knex.raw(`
    COMMENT ON COLUMN areas.es_predeterminada IS
      'Área protegida del sistema (Consultas/Estética): nombre/color/slug nunca se editan y nunca se elimina, pero sí se puede activar/desactivar — mismo criterio que plantillas_whatsapp.es_predeterminada.'
  `);

  for (const { nombre, slug } of AREAS_PREDETERMINADAS) {
    await knex('areas')
      .insert({ nombre, slug, activo: true, es_predeterminada: true, creado_en: knex.fn.now() })
      .onConflict('slug')
      .merge({ es_predeterminada: true });

    await knex('permissions')
      .insert(
        AGENDA_ACCIONES.map(([accion, accionLabel]) => ({
          modulo: `agenda_${slug}`,
          accion,
          codigo: `agenda.${slug}.${accion}`,
          descripcion: `${accionLabel} citas de ${nombre}`,
        })),
      )
      .onConflict('codigo')
      .ignore();
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('areas', (table) => {
    table.dropColumn('es_predeterminada');
  });
};
