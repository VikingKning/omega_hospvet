// Auto-provisión de permisos de agenda (areas.repository.js#asegurarPermisosAgenda,
// mismo día): a partir de ahora, dar de alta o reactivar un área crea/asegura
// sus propios 5 permisos `agenda_<slug>.<accion>` — pero cualquier área que
// ya existiera ANTES de este cambio (las 8 fijas de 06_areas_agenda.js ya
// están cubiertas por 01_permissions.js, pero una creada a mano desde el
// catálogo de Áreas antes de hoy pudo quedar sin los suyos) se queda huérfana
// para siempre si nadie la edita/reactiva. Esta migración de datos (no de
// esquema) recorre TODAS las áreas existentes (activas e inactivas — un área
// dada de baja también merece tener sus permisos listos para cuando alguien
// la reactive) y asegura sus 5 permisos, idempotente vía
// onConflict('codigo').ignore() — las 8 áreas fijas no generan filas nuevas
// (sus permisos ya existen desde 01_permissions.js), solo las huérfanas.
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

// No hay reversión limpia posible: una vez insertados, no se puede
// distinguir un permiso creado por este backfill de uno que ya existía o
// de uno otorgado después a mano. Migración de datos aditiva, documentada
// como irreversible a propósito — down() es intencionalmente un no-op.
exports.down = async function down() {};
