// Pedido explícito del usuario: el formulario de Tutores y Pacientes
// necesita capturar el sexo y la edad de cada paciente — ninguno de los dos
// existe en `mascotas` hoy. AVISO EXPLÍCITO: esto se desvía del schema
// original del cliente (assets/sql/Omega-Database.sql no define estas
// columnas en `mascotas`), mismo criterio ya aplicado en
// 20260826000001_reemplazar_requiere_zona_por_campo_adicional.js.
//
// La edad NO se guarda como el entero que el usuario captura (pedido
// explícito del usuario): "si pongo 13 años, guardar el año -13, así el
// siguiente año podría verse 14 automáticamente" — se guarda el año de
// nacimiento implícito (año actual - edad capturada) en vez de la edad en
// sí, para que "cuántos años tiene" se recalcule solo con el paso del
// tiempo en vez de quedarse congelado en lo que se capturó el día del
// registro. tutores.service.js hace la conversión edad<->año en ambos
// sentidos — el formulario sigue mostrando/pidiendo "años", nunca un año de
// nacimiento, eso es un detalle de persistencia que no le compete al
// usuario del sistema.
//
// Ambas columnas nullable, mismo criterio que `tipo`/`raza` (opcionales, no
// todos los registros van a tener el dato capturado desde el día 1).
exports.up = function up(knex) {
  return knex.schema.alterTable('mascotas', (table) => {
    table.string('sexo', 10);
    table.integer('anio_nacimiento');
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('mascotas', (table) => {
    table.dropColumn('sexo');
    table.dropColumn('anio_nacimiento');
  });
};
