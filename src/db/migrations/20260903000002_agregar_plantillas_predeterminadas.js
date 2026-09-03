// Pedido explícito del usuario: 4 plantillas "del sistema" — una por cada
// categoria_clasificacion sin acción real todavía (emergencia,
// agendar_cita, resultados_laboratorio) más el catch-all genérico
// (sin_coincidencia). Reemplazan los textos que hasta ahora vivían fijos
// en whatsapp.service.js — ahora son editables desde el catálogo, pero
// es_predeterminada=true las marca como inborrables (ver
// plantillas_whatsapp.service.js#desactivar/editar).
const TELEFONO_CLINICA = '7711634578';

const PLANTILLAS_PREDETERMINADAS = [
  {
    intencion: 'emergencia_medica',
    slug: 'emergencia-medica',
    texto_respuesta:
      `Recibimos tu mensaje y detectamos que podría tratarse de una urgencia. ` +
      `Un miembro del equipo se pondrá en contacto contigo lo antes posible. ` +
      `Si es una urgencia real, por favor llama de inmediato al ${TELEFONO_CLINICA} o acude directamente a la clínica.`,
  },
  {
    intencion: 'agendar_cita_default',
    slug: 'agendar-cita-default',
    texto_respuesta:
      `Gracias por escribirnos. Por el momento, para agendar, mover o cancelar una cita ` +
      `contáctanos directamente al ${TELEFONO_CLINICA} y con gusto te ayudamos.`,
  },
  {
    intencion: 'resultados_laboratorio_default',
    slug: 'resultados-laboratorio-default',
    texto_respuesta:
      `Gracias por escribirnos. Para consultar el estado de tus resultados de laboratorio, ` +
      `contáctanos al ${TELEFONO_CLINICA} y con gusto te apoyamos.`,
  },
  {
    intencion: 'sin_coincidencia_default',
    slug: 'sin-coincidencia-default',
    texto_respuesta:
      `Recibimos tu mensaje. Te recomendamos hacer una visita para valoración y mejor ` +
      `diagnóstico del problema de tu mascota. Contáctanos al ${TELEFONO_CLINICA} para agendar.`,
  },
];

exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.boolean('es_predeterminada').notNullable().defaultTo(false);
  });

  await knex('plantillas_whatsapp').insert(
    PLANTILLAS_PREDETERMINADAS.map((p) => ({
      ...p,
      activo: true,
      es_predeterminada: true,
      veces_usada: 0,
      creado_en: knex.fn.now(),
    })),
  );
};

exports.down = async function down(knex) {
  await knex('plantillas_whatsapp')
    .whereIn(
      'slug',
      PLANTILLAS_PREDETERMINADAS.map((p) => p.slug),
    )
    .del();
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.dropColumn('es_predeterminada');
  });
};
