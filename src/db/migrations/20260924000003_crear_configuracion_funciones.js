const FUNCIONES_PREDETERMINADAS = [
  {
    clave: 'laboratorio_envio_whatsapp',
    grupo: 'laboratorio',
    nombre: 'Envío de resultados por WhatsApp',
    descripcion: 'Permite enviar resultados de laboratorio por WhatsApp.',
  },
  {
    clave: 'laboratorio_envio_correo',
    grupo: 'laboratorio',
    nombre: 'Envío de resultados por correo',
    descripcion: 'Permite enviar resultados de laboratorio por correo electrónico.',
  },
  {
    clave: 'whatsapp_respuestas_automaticas',
    grupo: 'whatsapp',
    nombre: 'Respuestas automáticas',
    descripcion: 'Permite que el asistente responda automáticamente mensajes entrantes.',
  },
  {
    clave: 'whatsapp_citas_consultas',
    grupo: 'whatsapp',
    nombre: 'Citas de Consultas',
    descripcion: 'Permite ofrecer el flujo de citas para Consultas por WhatsApp.',
  },
  {
    clave: 'whatsapp_citas_estetica',
    grupo: 'whatsapp',
    nombre: 'Citas de Estética',
    descripcion: 'Permite ofrecer el flujo de citas para Estética por WhatsApp.',
  },
  {
    clave: 'whatsapp_aviso_privacidad',
    grupo: 'whatsapp',
    nombre: 'Aviso de privacidad',
    descripcion: 'Permite solicitar el consentimiento de privacidad por WhatsApp.',
  },
];

exports.up = async function up(knex) {
  await knex.schema.createTable('configuracion_funciones', (table) => {
    table.string('clave', 80).primary();
    table.string('grupo', 30).notNullable();
    table.string('nombre', 150).notNullable();
    table.text('descripcion').nullable();
    table.boolean('habilitado').notNullable().defaultTo(true);
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table
      .integer('actualizado_por')
      .nullable()
      .references('id')
      .inTable('usuarios')
      .onDelete('SET NULL');
    table.check("grupo in ('laboratorio', 'whatsapp')", [], 'configuracion_funciones_grupo_ck');
  });

  await knex.schema.createTable('configuracion_funciones_auditoria', (table) => {
    table.bigIncrements('id').primary();
    table
      .string('clave', 80)
      .notNullable()
      .references('clave')
      .inTable('configuracion_funciones')
      .onUpdate('CASCADE')
      .onDelete('RESTRICT');
    table.boolean('valor_anterior').notNullable();
    table.boolean('valor_nuevo').notNullable();
    table
      .integer('cambiado_por')
      .nullable()
      .references('id')
      .inTable('usuarios')
      .onDelete('SET NULL');
    table.timestamp('cambiado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['clave', 'cambiado_en'], 'configuracion_funciones_auditoria_clave_fecha_idx');
    table.index('cambiado_por', 'configuracion_funciones_auditoria_usuario_idx');
    table.check('valor_anterior <> valor_nuevo', [], 'configuracion_funciones_auditoria_cambio_ck');
  });

  await knex('configuracion_funciones').insert(
    FUNCIONES_PREDETERMINADAS.map((funcion) => ({ ...funcion, habilitado: true })),
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('configuracion_funciones_auditoria');
  await knex.schema.dropTableIfExists('configuracion_funciones');
};

exports.FUNCIONES_PREDETERMINADAS = FUNCIONES_PREDETERMINADAS;
