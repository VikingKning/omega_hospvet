// Pedido explícito del usuario: acortar el nombre del tutor en la tabla de
// Laboratorio ("un nombre y un apellido" en vez del nombre completo) requería
// primero separar `propietarios.nombre` de verdad — hoy es un solo campo de
// texto libre (ej. "Miguel Sanchez Juarez"), a diferencia de `doctores` que
// ya tiene `nombre`/`apellidos` propios desde el día 1. Se le preguntó
// explícitamente al usuario entre esto (separar el campo, recomendado) o solo
// partir el texto visualmente sin tocar el schema — eligió separar el campo.
//
// Backfill determinista: primera palabra = nombre, todo lo demás = apellidos
// (cubre el caso más común en México: 1 nombre + 2 apellidos). Un tutor con
// una sola palabra capturada queda con apellidos = '' (nunca NULL). Es un
// split heurístico — algún caso legacy puede quedar mal partido (ej. "Miguel
// Ángel Sanchez Juarez" pierde que "Ángel" era parte del nombre), corregible
// a mano desde el formulario de edición después.
exports.up = async function up(knex) {
  await knex.schema.alterTable('propietarios', (table) => {
    table.string('apellidos', 150);
  });

  await knex.raw(`
    UPDATE propietarios
    SET apellidos = CASE WHEN position(' ' in nombre) > 0
          THEN trim(substring(nombre from position(' ' in nombre) + 1))
          ELSE '' END,
        nombre = split_part(nombre, ' ', 1)
  `);

  await knex.schema.alterTable('propietarios', (table) => {
    table.string('apellidos', 150).notNullable().alter();
  });
};

// Reversible de verdad (mismo criterio que
// 20260819000001_normalizar_telefonos_sin_guiones.js) — no reconstruye
// espacios exactos originales si el nombre tenía formato irregular, mismo
// trade-off ya aceptado ahí.
exports.down = async function down(knex) {
  await knex.raw(`UPDATE propietarios SET nombre = trim(nombre || ' ' || apellidos)`);
  await knex.schema.alterTable('propietarios', (table) => {
    table.dropColumn('apellidos');
  });
};
