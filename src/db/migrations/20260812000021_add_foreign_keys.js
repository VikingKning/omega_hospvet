const fks = [
  ['usuarios', 'doctor_id', 'doctores', 'id'],
  ['usuarios', 'creado_por', 'usuarios', 'id'],
  ['usuarios', 'actualizado_por', 'usuarios', 'id'],
  ['usuarios', 'desactivado_por', 'usuarios', 'id'],

  ['usuario_permisos', 'usuario_id', 'usuarios', 'id'],
  ['usuario_permisos', 'permission_id', 'permissions', 'id'],
  ['usuario_permisos', 'otorgado_por', 'usuarios', 'id'],

  ['password_reset_tokens', 'usuario_id', 'usuarios', 'id'],

  ['propietarios', 'creado_por', 'usuarios', 'id'],
  ['propietarios', 'actualizado_por', 'usuarios', 'id'],
  ['propietarios', 'desactivado_por', 'usuarios', 'id'],

  ['mascotas', 'propietario_id', 'propietarios', 'id'],
  ['mascotas', 'creado_por', 'usuarios', 'id'],
  ['mascotas', 'actualizado_por', 'usuarios', 'id'],
  ['mascotas', 'desactivado_por', 'usuarios', 'id'],

  ['doctores', 'creado_por', 'usuarios', 'id'],
  ['doctores', 'actualizado_por', 'usuarios', 'id'],
  ['doctores', 'desactivado_por', 'usuarios', 'id'],

  ['areas', 'creado_por', 'usuarios', 'id'],
  ['areas', 'actualizado_por', 'usuarios', 'id'],
  ['areas', 'desactivado_por', 'usuarios', 'id'],

  ['doctor_area', 'doctor_id', 'doctores', 'id'],
  ['doctor_area', 'area_id', 'areas', 'id'],

  ['citas', 'area_id', 'areas', 'id'],
  ['citas', 'doctor_id', 'doctores', 'id'],
  ['citas', 'mascota_id', 'mascotas', 'id'],
  ['citas', 'creado_por', 'usuarios', 'id'],
  ['citas', 'confirmada_por', 'usuarios', 'id'],
  ['citas', 'cancelado_por', 'usuarios', 'id'],
  ['citas', 'actualizado_por', 'usuarios', 'id'],

  ['registros_laboratorio', 'mascota_id', 'mascotas', 'id'],
  ['registros_laboratorio', 'doctor_id', 'doctores', 'id'],
  ['registros_laboratorio', 'eliminado_por', 'usuarios', 'id'],
  ['registros_laboratorio', 'creado_por', 'usuarios', 'id'],
  ['registros_laboratorio', 'actualizado_por', 'usuarios', 'id'],

  ['estudios_solicitados', 'registro_laboratorio_id', 'registros_laboratorio', 'id'],
  ['estudios_solicitados', 'estudio_id', 'catalogo_estudios', 'id'],
  ['estudios_solicitados', 'zona_anatomica_id', 'catalogo_zonas_anatomicas', 'id'],
  ['estudios_solicitados', 'archivo_id', 'archivos_laboratorio', 'id'],

  ['catalogo_estudios', 'categoria_id', 'catalogo_categorias_estudio', 'id'],

  ['archivos_laboratorio', 'registro_laboratorio_id', 'registros_laboratorio', 'id'],
  ['archivos_laboratorio', 'cargado_por', 'usuarios', 'id'],

  ['envios_laboratorio', 'registro_laboratorio_id', 'registros_laboratorio', 'id'],
  ['envios_laboratorio', 'enviado_por', 'usuarios', 'id'],

  ['envio_archivo', 'envio_id', 'envios_laboratorio', 'id'],
  ['envio_archivo', 'archivo_id', 'archivos_laboratorio', 'id'],

  ['plantillas_whatsapp', 'creado_por', 'usuarios', 'id'],
  ['plantillas_whatsapp', 'actualizado_por', 'usuarios', 'id'],
  ['plantillas_whatsapp', 'desactivado_por', 'usuarios', 'id'],

  ['mensajes_whatsapp', 'plantilla_id', 'plantillas_whatsapp', 'id'],
  ['mensajes_whatsapp', 'cita_generada_id', 'citas', 'id'],
  ['mensajes_whatsapp', 'registro_laboratorio_id', 'registros_laboratorio', 'id'],
];

exports.up = async function up(knex) {
  for (const [table, column, refTable, refColumn] of fks) {
    await knex.schema.alterTable(table, (t) => {
      t.foreign(column).references(refColumn).inTable(refTable).deferrable('immediate');
    });
  }
};

exports.down = async function down(knex) {
  for (const [table, column] of [...fks].reverse()) {
    await knex.schema.alterTable(table, (t) => {
      t.dropForeign(column);
    });
  }
};
