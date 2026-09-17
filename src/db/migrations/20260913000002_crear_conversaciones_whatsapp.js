exports.up = async function up(knex) {
  await knex.schema.createTable('conversaciones_whatsapp', (table) => {
    table.increments('id').primary();
    table.string('phone_number_id', 32).notNullable();
    table.string('telefono_normalizado', 20).notNullable();
    table.string('estado', 20).notNullable().defaultTo('acumulando');
    table.string('flujo_actual', 50);
    table.string('paso_actual', 50);
    table.timestamp('primer_fragmento_en', { useTz: true }).notNullable();
    table.timestamp('ultima_interaccion_en', { useTz: true }).notNullable();
    table.timestamp('procesar_despues_de', { useTz: true });
    table.timestamp('atencion_humana_desde', { useTz: true });
    table.timestamp('atencion_humana_hasta', { useTz: true });
    table.timestamp('cerrado_en', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE UNIQUE INDEX conversaciones_whatsapp_abierta_unique
      ON conversaciones_whatsapp (phone_number_id, telefono_normalizado)
      WHERE estado <> 'cerrada';

    COMMENT ON TABLE "conversaciones_whatsapp" IS 'Una fila por interacción activa (o cerrada, como historial) entre un número oficial de WhatsApp de Omega y el teléfono normalizado de un tutor (US WA 002); agrupa mensajes_whatsapp y controla el estado del bot/flujo.';
    COMMENT ON COLUMN "conversaciones_whatsapp"."phone_number_id" IS 'phone_number_id de Meta (value.metadata.phone_number_id del webhook) del número oficial de Omega que recibió el mensaje — junto con telefono_normalizado evita colisiones si Omega llega a operar más de un número (AC2).';
    COMMENT ON COLUMN "conversaciones_whatsapp"."telefono_normalizado" IS 'Teléfono del tutor normalizado (mismo criterio que whatsapp.service.js#normalizarNumeroSalida: colapsa el 521 a 52 del wa_id mexicano) — nunca el wa_id crudo (AC1).';
    COMMENT ON COLUMN "conversaciones_whatsapp"."estado" IS 'acumulando (agrupando fragmentos) | procesando (reservado, sin uso en US WA 002) | esperando_menu (bot esperando selección de menú) | flujo_activo (dentro de un flujo de varios pasos, ver flujo_actual/paso_actual) | atencion_humana (bot desactivado, atiende personal) | cerrada (histórica, nunca se reabre, AC10)';
  `);
};

exports.down = function down(knex) {
  return knex.schema.dropTable('conversaciones_whatsapp');
};
