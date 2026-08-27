// Reemplaza `requiere_zona` (boolean) por `campo_adicional` (varchar) —
// pedido explícito del usuario: el catálogo completo de laboratorio trae
// más de un tipo de campo extra según el estudio (zona anatómica, tipo de
// muestra + antibiograma, origen de tejido + lateralidad, componentes de
// líquido corporal), y un estudio nunca necesita más de uno a la vez — un
// solo campo tipo-enum (validado en laboratorio.service.js, mismo criterio
// que DURACIONES_VALIDAS en agenda.service.js) es más simple
// que 4 columnas booleanas sueltas. AVISO EXPLÍCITO: esto se desvía del
// schema original del cliente (assets/sql/Omega-Database.sql definía
// `requiere_zona` boolean) — decisión tomada en conjunto con el usuario al
// planear el catálogo completo de Laboratorio.
exports.up = async function up(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.dropColumn('requiere_zona');
    table.string('campo_adicional', 30);
  });
  await knex.raw(`
    COMMENT ON COLUMN "catalogo_estudios"."campo_adicional" IS 'zona | tipo_muestra | tejido_lateralidad | componentes_liquido | NULL (sin campo adicional)';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.dropColumn('campo_adicional');
    table.boolean('requiere_zona').notNullable().defaultTo(false);
  });
};
