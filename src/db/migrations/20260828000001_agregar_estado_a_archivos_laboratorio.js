// US-409 v2: el estado de un archivo (cargado/enviado/retirado) reemplaza
// la heurística implícita de "¿sigue vinculado a algún estudio?" — mismo
// patrón que usuarios.estatus/registros_laboratorio.estado, ya establecido
// en todo el resto del proyecto. `retirado_por`/`retirado_en` documentan
// quién y cuándo desvinculó un archivo (antes no existía ningún rastro de
// auditoría para eso); `enviado_por`/`enviado_en` se provisionan ahora sin
// disparador real todavía (laboratorio.enviar sigue siendo un stub), mismo
// criterio ya usado con hash_contenido/laboratorio.cargar en su momento.
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

  // Backfill: archivos ya "quitados" antes de que existiera este estado
  // (huérfanos, ningún estudios_solicitados.archivo_id los referencia) pasan
  // a retirado; el resto conserva el default 'cargado' recién aplicado.
  await knex.raw(`
    UPDATE archivos_laboratorio
    SET estado = 'retirado'
    WHERE id NOT IN (
      SELECT archivo_id FROM estudios_solicitados WHERE archivo_id IS NOT NULL
    );
  `);

  // Datos reales de prueba (dev) ya traían filas duplicadas por hash que
  // SÍ seguían referenciadas (subidas repetidas antes de que existiera esta
  // validación) — sin este 2º paso, la creación del índice único de abajo
  // truena. Entre empates activos por el mismo hash, se conserva solo la
  // más reciente (`cargado_en` más alto); las demás pasan a retirado — no
  // se pierde nada (el archivo físico y la fila siguen intactos, la
  // descarga autenticada no filtra por estado), solo dejan de contar como
  // "en uso" para la validación de duplicados hacia adelante.
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

  // US-409: garantiza a nivel de BD que un mismo hash nunca esté ACTIVO
  // (cargado/enviado) en más de un registro a la vez — cierra la ventana de
  // carrera real entre 2 cargas concurrentes con el mismo contenido (AC
  // explícito). El chequeo de la aplicación ya cubre el 99.99% de los
  // casos; esto es el respaldo transaccional para el resto.
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
