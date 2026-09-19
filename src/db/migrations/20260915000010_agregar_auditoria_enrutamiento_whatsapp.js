exports.up = async function up(knex) {
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.string('ruta_enrutamiento', 40);
    table.string('categoria_resuelta', 50);
    table.string('intencion_resuelta', 150);
    table.string('resultado_decision', 50);
    table.string('etiqueta_modelo', 150);
    table.timestamp('enrutado_en', { useTz: true });
  });

  await knex.raw(`
    UPDATE grupos_whatsapp
       SET tokens_entrada = COALESCE(tokens_entrada, 0),
           tokens_salida = COALESCE(tokens_salida, 0);

    ALTER TABLE grupos_whatsapp
      ALTER COLUMN tokens_entrada SET DEFAULT 0,
      ALTER COLUMN tokens_entrada SET NOT NULL,
      ALTER COLUMN tokens_salida SET DEFAULT 0,
      ALTER COLUMN tokens_salida SET NOT NULL;

    ALTER TABLE grupos_whatsapp
      ADD CONSTRAINT grupos_whatsapp_ruta_enrutamiento_check
      CHECK (
        ruta_enrutamiento IS NULL OR ruta_enrutamiento IN (
          'atencion_humana',
          'respuesta_interactiva',
          'comando_menu',
          'medio_sin_texto',
          'flujo_activo',
          'saludo_puro',
          'consulta_libre'
        )
      ),
      ADD CONSTRAINT grupos_whatsapp_tokens_no_negativos_check
      CHECK (tokens_entrada >= 0 AND tokens_salida >= 0);

    COMMENT ON COLUMN grupos_whatsapp.ruta_enrutamiento IS 'Ruta cerrada elegida por el router de US WA 011 antes de Claude o del envío.';
    COMMENT ON COLUMN grupos_whatsapp.categoria_resuelta IS 'Categoría cerrada resuelta para auditoría; NULL en rutas deterministas que no clasifican contenido.';
    COMMENT ON COLUMN grupos_whatsapp.intencion_resuelta IS 'Intención de la plantilla o acción determinista finalmente utilizada.';
    COMMENT ON COLUMN grupos_whatsapp.resultado_decision IS 'Resultado funcional persistido antes del envío: menú, guía, plantilla o plantilla de respaldo.';
    COMMENT ON COLUMN grupos_whatsapp.etiqueta_modelo IS 'Etiqueta cerrada devuelta por Claude; NULL cuando no se llamó, falló o no hubo coincidencia.';
    COMMENT ON COLUMN grupos_whatsapp.enrutado_en IS 'Momento en que quedó persistida la decisión definitiva del router.';
    COMMENT ON COLUMN grupos_whatsapp.slug_resuelto IS 'Slug final de la plantilla utilizada; puede ser sin-coincidencia-default aunque Claude haya fallado o no devolviera una etiqueta utilizable.';
    COMMENT ON COLUMN grupos_whatsapp.clasificado_en IS 'Momento en que quedó finalizada la ruta de clasificación, incluida una decisión de respaldo por timeout, configuración ausente o etiqueta inválida.';
    COMMENT ON COLUMN grupos_whatsapp.estado IS 'pendiente_enrutamiento mientras no se confirma el efecto saliente | procesado cuando la ruta concluyó.';
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE grupos_whatsapp
      DROP CONSTRAINT IF EXISTS grupos_whatsapp_ruta_enrutamiento_check,
      DROP CONSTRAINT IF EXISTS grupos_whatsapp_tokens_no_negativos_check;

    ALTER TABLE grupos_whatsapp
      ALTER COLUMN tokens_entrada DROP NOT NULL,
      ALTER COLUMN tokens_entrada DROP DEFAULT,
      ALTER COLUMN tokens_salida DROP NOT NULL,
      ALTER COLUMN tokens_salida DROP DEFAULT;
  `);
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.dropColumn('ruta_enrutamiento');
    table.dropColumn('categoria_resuelta');
    table.dropColumn('intencion_resuelta');
    table.dropColumn('resultado_decision');
    table.dropColumn('etiqueta_modelo');
    table.dropColumn('enrutado_en');
  });
};
