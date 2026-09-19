const CODIGOS_REDUNDANTES = [
  'ANTIBIOGRAMA',
  'ANTIBIOGRAMA_URINARIO',
  'CULTIVO_DE_ORINA',
  'CULTIVO_BACTERIANO_BAL',
  'CULTIVO_BACTERIANO_DE_PIEL',
  'CULTIVO_DE_LCR',
  'CULTIVO_OTICO',
  'CULTIVO_DE_ORINA_UROCULTIVO',
  'CULTIVO_DE_SANGRE_HEMOCULTIVO',
];

const CULTIVOS_CON_MUESTRA_EXPLICITA = [
  'HEMOCULTIVO',
  'UROCULTIVO',
  'CULTIVO_DE_HERIDAS',
  'CULTIVO_DE_OIDO',
  'CULTIVO_DE_PIEL',
  'CULTIVO_DE_TEJIDOS',
  'CULTIVO_DE_LAVADO_BRONCOALVEOLAR',
  'CULTIVO_DE_LIQUIDO_CEFALORRAQUIDEO',
  'CULTIVO_DE_LIQUIDO_SINOVIAL',
  'CULTIVO_DE_LIQUIDOS_CAVITARIOS',
  'CULTIVO_FECAL',
  'CULTIVO_GENITAL',
  'CULTIVO_NASAL',
  'CULTIVO_OCULAR',
  'CULTIVO_OSEO',
  'CULTIVO_RESPIRATORIO',
  'CULTIVO_SEMINAL',
  'CULTIVO_VAGINAL',
  'CULTIVO_BACTERIANO_ORAL',
  'CULTIVO_MICOLOGICO_BAL',
];

exports.up = async function up(knex) {
  await knex('catalogo_estudios').whereIn('codigo', CODIGOS_REDUNDANTES).update({ activo: false });

  await knex('catalogo_estudios')
    .whereIn('codigo', CULTIVOS_CON_MUESTRA_EXPLICITA)
    .update({ campo_adicional: null });

  await knex('catalogo_estudios').update({ permite_antibiograma: false });
  await knex('catalogo_estudios')
    .where({ activo: true })
    .whereRaw("nombre ~* '^(cultivo|urocultivo|hemocultivo)'")
    .whereRaw("nombre !~* '(micológico|hongos)'")
    .update({ permite_antibiograma: true });
};

exports.down = async function down(knex) {
  await knex('catalogo_estudios')
    .whereIn('codigo', CULTIVOS_CON_MUESTRA_EXPLICITA)
    .update({ campo_adicional: 'tipo_muestra' });

  await knex('catalogo_estudios').whereIn('codigo', CODIGOS_REDUNDANTES).update({ activo: true });

  await knex('catalogo_estudios').update({ permite_antibiograma: false });
  await knex('catalogo_estudios')
    .where({ campo_adicional: 'tipo_muestra' })
    .whereRaw("nombre ~* '^(cultivo|urocultivo|hemocultivo)'")
    .whereRaw("nombre !~* '(micológico|hongos)'")
    .update({ permite_antibiograma: true });
};
