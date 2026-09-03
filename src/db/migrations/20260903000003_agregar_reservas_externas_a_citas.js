// Reservas hechas por el cliente vía la página de reservas de Google
// Calendar (Appointment Scheduling) de Consultas — importadas por
// agenda.googleSync.js#sincronizar()/agenda.reservasExternas.js. A
// diferencia de una cita creada por el portal, puede nacer sin mascota
// (ni siquiera con el tutor identificado) si el teléfono/nombre de
// mascota que puso el cliente no matcheó nada en el sistema — de ahí que
// mascota_id deje de ser NOT NULL, y se agregue propietario_id para
// conservar al tutor aunque la mascota siga sin definirse.
//
// El doctor fijo por default ("Consultas Omega") NO se siembra aquí — se
// crea perezosamente en agenda.repository.js#obtenerOCrearDoctorConsultasPredeterminado
// la primera vez que hace falta de verdad (el job de sincronización nunca
// corre en NODE_ENV=test). Sembrarlo en una migración rompería
// permanentemente doctores.test.js, que asume esa tabla completamente
// vacía en TODO entorno (incluido test) — regla explícita ya establecida
// en ese archivo, justo porque Jest corre los archivos de test en
// paralelo.
exports.up = async function up(knex) {
  await knex.schema.alterTable('citas', (table) => {
    table.integer('mascota_id').nullable().alter();
    table.integer('propietario_id');
  });

  await knex.raw(`
    COMMENT ON COLUMN "citas"."origen" IS 'portal | whatsapp | reserva_externa';
    COMMENT ON COLUMN "citas"."propietario_id" IS 'Solo se llena cuando mascota_id todavía no se puede determinar (reserva_externa) — normalmente el tutor se obtiene vía mascotas.propietario_id.';
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`COMMENT ON COLUMN "citas"."origen" IS 'portal | whatsapp'`);
  await knex.schema.alterTable('citas', (table) => {
    table.dropColumn('propietario_id');
    table.integer('mascota_id').notNullable().alter();
  });
};
