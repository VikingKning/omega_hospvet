exports.up = async function up(knex) {
  await knex.schema.alterTable('mascotas', (table) => {
    table.integer('nhc').nullable();
  });

  await knex.raw(`
    ALTER TABLE mascotas
    ADD CONSTRAINT mascotas_nhc_rango_ck
    CHECK (nhc IS NULL OR (nhc >= 0 AND nhc <= 99999999))
  `);

  // PostgreSQL permite varios NULL en un índice UNIQUE. Así los pacientes
  // históricos pueden seguir sin NHC, pero cualquier número capturado queda
  // reservado para una sola mascota, incluso si posteriormente se desactiva.
  await knex.raw(`
    CREATE UNIQUE INDEX mascotas_nhc_unique
    ON mascotas (nhc)
    WHERE nhc IS NOT NULL
  `);

  await knex.raw(`
    COMMENT ON COLUMN mascotas.nhc IS
    'Número de historial clínico de QVet. Entero opcional de hasta 8 dígitos y único entre mascotas.'
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS mascotas_nhc_unique');
  await knex.raw('ALTER TABLE mascotas DROP CONSTRAINT IF EXISTS mascotas_nhc_rango_ck');
  await knex.schema.alterTable('mascotas', (table) => {
    table.dropColumn('nhc');
  });
};
