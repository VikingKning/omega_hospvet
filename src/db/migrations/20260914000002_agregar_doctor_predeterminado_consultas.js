// Pedido explícito del usuario: Consultas siempre debe tener un doctor
// "Consultas Omega Genérico" — mismo criterio de protección que
// areas.es_predeterminada (20260914000001), aplicado aquí a
// doctores.service.js#editar/desactivar (bloqueo completo: ni renombrar ni
// dar de baja, a diferencia de las áreas que sí se pueden desactivar — este
// doctor es el fallback real que usa la sincronización de reservas externas
// de Google Calendar, ver agenda.repository.js#obtenerOCrearDoctorConsultasPredeterminado,
// así que debe seguir existiendo, activo y ligado a Consultas siempre).
//
// A propósito, esta migración NUNCA inserta el doctor — solo lo marca
// predeterminado si YA existe (creado antes en tiempo de ejecución por esa
// misma función). Sembrarlo aquí rompería permanentemente doctores.test.js,
// que asume esa tabla completamente vacía en TODO entorno incluido test
// (regla ya explícita en 20260903000003_agregar_reservas_externas_a_citas.js
// por esta misma razón). En un entorno donde el doctor todavía no existe
// (incluido .env.test, que siempre parte vacío), esta migración no hace
// nada — obtenerOCrearDoctorConsultasPredeterminado() lo crea perezosamente
// la primera vez que hace falta de verdad, ya con es_predeterminado:true
// desde su propio INSERT.
const NOMBRE = 'Consultas Omega';
const APELLIDOS = 'Generico';

exports.up = async function up(knex) {
  await knex.schema.alterTable('doctores', (table) => {
    table.boolean('es_predeterminado').notNullable().defaultTo(false);
  });
  await knex.raw(`
    COMMENT ON COLUMN doctores.es_predeterminado IS
      'Doctor protegido del sistema (fallback de Consultas): nunca se edita/renombra ni se da de baja — mismo criterio que areas.es_predeterminada.'
  `);

  const [doctor] = await knex('doctores')
    .where({ nombre: NOMBRE, apellidos: APELLIDOS })
    .update({ es_predeterminado: true })
    .returning('id');
  if (!doctor) return;

  const area = await knex('areas').where({ slug: 'consultas' }).first('id');
  if (area) {
    await knex('doctor_area')
      .insert({ doctor_id: doctor.id, area_id: area.id })
      .onConflict(['doctor_id', 'area_id'])
      .ignore();
  }
};

// No se revierte la data (mismo criterio que 20260914000001: nunca DELETE
// físico de una fila que ya pudo acumular historial de citas) — solo el
// cambio de schema.
exports.down = async function down(knex) {
  await knex.schema.alterTable('doctores', (table) => {
    table.dropColumn('es_predeterminado');
  });
};
