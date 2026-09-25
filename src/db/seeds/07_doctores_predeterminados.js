const DOCTORES_PREDETERMINADOS = [
  { nombre: 'Consultas Omega', apellidos: 'Generico', areaSlug: 'consultas' },
  { nombre: 'Estética Omega', apellidos: 'Generico', areaSlug: 'estetica' },
];

exports.seed = async function seed(knex) {
  for (const { nombre, apellidos, areaSlug } of DOCTORES_PREDETERMINADOS) {
    const area = await knex('areas').where({ slug: areaSlug }).first('id');
    if (!area) throw new Error(`No existe el área predeterminada: ${areaSlug}`);

    let doctor = await knex('doctores').where({ nombre, apellidos }).first('id');
    if (!doctor) {
      [doctor] = await knex('doctores')
        .insert({
          nombre,
          apellidos,
          activo: true,
          es_predeterminado: true,
          creado_por: null,
          creado_en: knex.fn.now(),
        })
        .returning('id');
    } else {
      await knex('doctores').where({ id: doctor.id }).update({
        activo: true,
        es_predeterminado: true,
        desactivado_por: null,
        desactivado_en: null,
      });
    }

    await knex('doctor_area')
      .insert({ doctor_id: doctor.id, area_id: area.id })
      .onConflict(['doctor_id', 'area_id'])
      .ignore();
  }
};

exports.DOCTORES_PREDETERMINADOS = DOCTORES_PREDETERMINADOS;
