// Reconstrucción del menú de navegación (sidebar.ejs): /agenda.html y
// /grooming.html pasan a protegerse con los permisos granulares
// `agenda.<slug>.ver` (módulo `agenda_<slug>` en el catálogo, con guion
// bajo — su `codigo` real usa punto; ya existentes desde US-604, catálogo
// emparejado 1:1 con la tabla `areas`) en vez de los planos legacy `agenda.ver`/
// `grooming.ver` — esos dos módulos nunca se exponen en la matriz de
// permisos desde que existe el tab "Agendas" granular (ver
// usuarios.service.js#construirTabAgendas), así que ningún administrador
// pudo otorgarlos/revocarlos nunca desde la UI; solo pudieron llegar a una
// cuenta por el seed de arranque (05_admin_usuario.js, que otorga TODO el
// catálogo al admin) o por una inserción manual directa a la BD.
//
// Migración de DATOS, no de esquema (no se toca ninguna tabla/columna) —
// aditiva y no destructiva a propósito: cualquier usuario que hoy tenga
// otorgado agenda.<accion>/grooming.<accion> recibe también el/los
// permisos granulares equivalentes, sin tocar ni borrar los permisos
// legacy ni el catálogo (quedan inertes, pero se dejan intactos por si
// algo más los referencia; limpiarlos es una decisión aparte, no forma
// parte de esta reconstrucción del menú). agenda.html combina en una sola
// página las áreas Consultas y Cirugías, así que cada permiso legacy de
// `agenda` se traduce a AMBOS granulares (agenda_consultas.<accion> y
// agenda_cirugias.<accion>) — requirePermission ya soporta la semántica OR
// para el acceso a la ruta.
const MAPEO_MODULO_LEGACY_A_GRANULARES = {
  agenda: ['agenda_consultas', 'agenda_cirugias'],
  grooming: ['agenda_grooming'],
};

exports.up = async function up(knex) {
  for (const [moduloLegacy, modulosGranulares] of Object.entries(
    MAPEO_MODULO_LEGACY_A_GRANULARES,
  )) {
    const permisosLegacy = await knex('permissions').where({ modulo: moduloLegacy });

    for (const permisoLegacy of permisosLegacy) {
      const grants = await knex('usuario_permisos').where({ permission_id: permisoLegacy.id });
      if (!grants.length) continue;

      for (const moduloGranular of modulosGranulares) {
        const permisoGranular = await knex('permissions')
          .where({ modulo: moduloGranular, accion: permisoLegacy.accion })
          .first('id');
        if (!permisoGranular) continue;

        for (const grant of grants) {
          const yaLoTiene = await knex('usuario_permisos')
            .where({ usuario_id: grant.usuario_id, permission_id: permisoGranular.id })
            .first('usuario_id');
          if (yaLoTiene) continue;

          await knex('usuario_permisos').insert({
            usuario_id: grant.usuario_id,
            permission_id: permisoGranular.id,
            otorgado_por: grant.otorgado_por,
            otorgado_en: grant.otorgado_en,
          });
        }
      }
    }
  }
};

// No hay reversión limpia posible: una vez otorgados, no se puede
// distinguir un permiso granular creado por esta migración de uno
// otorgado después a mano por un administrador (o vuelto a otorgar por el
// re-sync del admin de arranque). Migración de datos aditiva, documentada
// como irreversible a propósito — down() es intencionalmente un no-op.
exports.down = async function down() {};
