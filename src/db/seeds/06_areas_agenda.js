const AREAS_AGENDA = [
  ['Consultas', 'consultas'],
  ['Cirugías', 'cirugias'],
  ['Grooming', 'grooming'],
  ['Cardiología', 'cardiologia'],
  ['Oftalmología', 'oftalmologia'],
  ['Terapia', 'terapia'],
  ['Dermatología', 'dermatologia'],
  ['Neurología', 'neurologia'],
];

exports.seed = async function seed(knex) {
  for (const [nombre, slug] of AREAS_AGENDA) {
    const existente = await knex('areas').where({ slug }).first('id');
    if (existente) continue;

    await knex('areas').insert({
      nombre,
      slug,
      creado_por: null,
      creado_en: knex.fn.now(),
    });
  }
};
