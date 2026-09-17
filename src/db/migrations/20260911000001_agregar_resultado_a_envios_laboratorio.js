exports.up = async function up(knex) {
  await knex.schema.alterTable('envios_laboratorio', (table) => {
    table.string('canal_intentado', 20);
    table.boolean('correo_exitoso');
    table.boolean('whatsapp_exitoso');
    table.text('error_correo');
    table.text('error_whatsapp');
  });

  await knex('envios_laboratorio').update({
    canal_intentado: knex.ref('medio'),
    correo_exitoso: knex.raw("case when medio in ('correo', 'ambos') then true else null end"),
    whatsapp_exitoso: knex.raw("case when medio in ('whatsapp', 'ambos') then true else null end"),
  });

  await knex.schema.alterTable('envios_laboratorio', (table) => {
    table.string('canal_intentado', 20).notNullable().alter();
    table.string('medio', 20).nullable().alter();
  });

  await knex.raw(`
    COMMENT ON COLUMN "envios_laboratorio"."canal_intentado" IS 'correo | whatsapp | ambos; canales que se intentaron en la operación';
    COMMENT ON COLUMN "envios_laboratorio"."medio" IS 'correo | whatsapp | ambos; canales exitosos, o NULL si todos fallaron';
    COMMENT ON COLUMN "envios_laboratorio"."correo_exitoso" IS 'TRUE/FALSE si se intentó correo; NULL si no se intentó';
    COMMENT ON COLUMN "envios_laboratorio"."whatsapp_exitoso" IS 'TRUE/FALSE si se intentó WhatsApp; NULL si no se intentó';
  `);
};

exports.down = async function down(knex) {
  await knex('envios_laboratorio')
    .whereNull('medio')
    .update({ medio: knex.ref('canal_intentado') });

  await knex.schema.alterTable('envios_laboratorio', (table) => {
    table.string('medio', 20).notNullable().alter();
    table.dropColumns(
      'canal_intentado',
      'correo_exitoso',
      'whatsapp_exitoso',
      'error_correo',
      'error_whatsapp',
    );
  });
};
