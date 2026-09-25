const PERFILES_BIOQUIMICOS = [
  { codigo: 'PERFIL_BASICO', nombre: 'Perfil bioquímico básico' },
  { codigo: 'PERFIL_GENERAL', nombre: 'Perfil bioquímico general' },
  { codigo: 'PERFIL_INTEGRAL', nombre: 'Perfil bioquímico completo' },
];

const NOMBRES_ANTERIORES = new Map([
  ['PERFIL_BASICO', 'Perfil básico'],
  ['PERFIL_GENERAL', 'Perfil general'],
  ['PERFIL_INTEGRAL', 'Perfil integral'],
]);

async function categoriaId(knex, nombre) {
  const categoria = await knex('catalogo_categorias_estudio').where({ nombre }).first('id');
  return categoria?.id;
}

exports.up = async function up(knex) {
  const destinoId = await categoriaId(knex, 'Química sanguínea / Bioquímica');
  if (!destinoId) return;

  for (const { codigo, nombre } of PERFILES_BIOQUIMICOS) {
    await knex('catalogo_estudios')
      .where({ codigo })
      .update({ categoria_id: destinoId, nombre, activo: true });
  }
};

exports.down = async function down(knex) {
  const destinoId = await categoriaId(knex, 'Perfiles clínicos / Paneles');
  if (!destinoId) return;

  for (const { codigo } of PERFILES_BIOQUIMICOS) {
    await knex('catalogo_estudios')
      .where({ codigo })
      .update({ categoria_id: destinoId, nombre: NOMBRES_ANTERIORES.get(codigo) });
  }
};

exports.PERFILES_BIOQUIMICOS = PERFILES_BIOQUIMICOS;
