// Tabla requerida por connect-pg-simple para persistir sesiones de express-session
// (Decisión 4 de la bitácora: sesiones en PostgreSQL, sin Redis). Esquema tomado
// del schema.sql oficial del paquete.
exports.up = function up(knex) {
  return knex.schema.createTable('session', (table) => {
    table.string('sid').primary().notNullable();
    table.json('sess').notNullable();
    table.timestamp('expire', { precision: 6 }).notNullable();
    table.index('expire', 'IDX_session_expire');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTable('session');
};
