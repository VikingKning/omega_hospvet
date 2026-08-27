// Pedido explícito del usuario: filtrar los estudios del picker de
// Laboratorio según la especie del paciente seleccionado (perro/gato). La
// mayoría de los ~785 estudios del catálogo aplican a ambas especies
// (NULL); solo se marca cuando el estudio es exclusivo de una — las dos
// categorías "Enfermedades infecciosas - Perro/Gato" completas, y
// cualquier otro estudio cuyo propio nombre ya lo diga (ej. "Panel
// tiroideo felino", "TLI canina"). AVISO EXPLÍCITO: esto se desvía del
// schema original del cliente (assets/sql/Omega-Database.sql no tiene
// esta columna) — mismo criterio ya aplicado para `campo_adicional`.
exports.up = async function up(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.string('especie', 10);
  });
  await knex.raw(`
    COMMENT ON COLUMN "catalogo_estudios"."especie" IS 'Perro | Gato | NULL (aplica a ambas especies)';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.dropColumn('especie');
  });
};
