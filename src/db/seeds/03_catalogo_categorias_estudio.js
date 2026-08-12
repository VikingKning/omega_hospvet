const categorias = [
  'Hematología',
  'Bioquímica sanguínea',
  'Endocrinología',
  'Orina',
  'Heces',
  'Serología - Perros',
  'Serología - Gatos',
  'Citología e histopatología',
  'Imagenología',
  'Genética y reproducción',
];

exports.seed = async function seed(knex) {
  await knex('catalogo_estudios').del();
  await knex('catalogo_categorias_estudio').del();
  await knex('catalogo_categorias_estudio').insert(categorias.map((nombre) => ({ nombre })));
};
