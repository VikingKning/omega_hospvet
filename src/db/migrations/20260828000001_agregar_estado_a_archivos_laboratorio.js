exports.up = async function up(knex) {
  await knex.schema.alterTable('archivos_laboratorio', (table) => {
    table.string('estado', 20).notNullable().defaultTo('cargado');
    table.integer('retirado_por').references('id').inTable('usuarios');
    table.timestamp('retirado_en', { useTz: true });
    table.integer('enviado_por').references('id').inTable('usuarios');
    table.timestamp('enviado_en', { useTz: true });
  });

  await knex.raw(`
    ALTER TABLE archivos_laboratorio
      ADD CONSTRAINT archivos_laboratorio_estado_check
      CHECK (estado IN ('cargado', 'enviado', 'retirado'));
  `);

  await knex.raw(`
    UPDATE archivos_laboratorio
    SET estado = 'retirado'
    WHERE id NOT IN (
      SELECT archivo_id FROM estudios_solicitados WHERE archivo_id IS NOT NULL
    );
  `);

  await knex.raw(`
    WITH duplicados_activos AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY hash_contenido ORDER BY cargado_en DESC, id DESC
        ) AS orden
      FROM archivos_laboratorio
      WHERE estado != 'retirado'
    )
    UPDATE archivos_laboratorio
    SET estado = 'retirado'
    WHERE id IN (SELECT id FROM duplicados_activos WHERE orden > 1);
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX archivos_laboratorio_hash_activo_unique
      ON archivos_laboratorio (hash_contenido)
      WHERE estado IN ('cargado', 'enviado');
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS archivos_laboratorio_hash_activo_unique');
  await knex.raw(
    'ALTER TABLE archivos_laboratorio DROP CONSTRAINT IF EXISTS archivos_laboratorio_estado_check',
  );
  await knex.schema.alterTable('archivos_laboratorio', (table) => {
    table.dropColumn('estado');
    table.dropColumn('retirado_por');
    table.dropColumn('retirado_en');
    table.dropColumn('enviado_por');
    table.dropColumn('enviado_en');
  });
};
