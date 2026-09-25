const AREAS_AGENDA = [
  ['Consultas', 'consultas'],
  ['Estética', 'estetica'],
];

exports.seed = async function seed(knex) {
  for (const [nombre, slug] of AREAS_AGENDA) {
    await knex('areas')
      .insert({
        nombre,
        slug,
        activo: true,
        es_predeterminada: true,
        creado_por: null,
        creado_en: knex.fn.now(),
      })
      .onConflict('slug')
      .merge({
        nombre,
        activo: true,
        es_predeterminada: true,
        desactivado_por: null,
        desactivado_en: null,
      });
  }
};

exports.AREAS_AGENDA = AREAS_AGENDA;
