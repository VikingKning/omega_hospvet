// Mismo criterio que archivos_laboratorio.hash_contenido (ver migración
// 20260812000016): permite detectar que un PDF ya se cargó antes aunque el
// admin le haya puesto una versión distinta cada vez — el bug real que
// motivó esto (dos archivos físicos idénticos con "v0"/"v2" en vez de
// detectarse como el mismo aviso).
exports.up = async function up(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.string('hash_contenido', 64).nullable();
    table.index('hash_contenido');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.dropIndex('hash_contenido');
    table.dropColumn('hash_contenido');
  });
};
