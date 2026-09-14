// Pedido explícito del usuario: 2 áreas "del sistema" que siempre deben
// existir — Consultas y Estética. No borrables (ya no existe un DELETE
// físico en el módulo, solo baja lógica) ni editables (nombre/color/slug
// fijos), pero SÍ se pueden activar/desactivar — mismo criterio de
// `es_predeterminada` ya usado en plantillas_whatsapp (ver
// 20260903000002_agregar_plantillas_predeterminadas.js), aplicado aquí a
// `areas.service.js#editar/desactivar` en vez de solo `desactivar`.
//
// 'Consultas' (slug 'consultas') ya existe en la mayoría de entornos desde
// el seed 06_areas_agenda.js — el upsert por slug la marca predeterminada
// in-place, sin tocar su id/citas ya agendadas. 'Estética' es nueva: se
// crea aquí mismo (no se depende de que alguien corra el seed) y se le
// aprovisionan sus 5 permisos de agenda, mismo shape que
// areas.repository.js#permisosAgendaDelArea — duplicado a propósito, igual
// criterio que esa función documenta sobre 01_permissions.js.
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

// No se revierte la data (ni la fila de 'Estética' ni sus permisos): mismo
// criterio de "nunca DELETE físico" que rige todo el módulo — para cuando
// este down() corriera, 'Estética' ya pudo tener citas agendadas
// referenciándola. Solo se revierte el cambio de schema.
exports.down = async function down(knex) {
  await knex.schema.alterTable('areas', (table) => {
    table.dropColumn('es_predeterminada');
  });
};
