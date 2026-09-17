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

exports.down = async function down() {};
