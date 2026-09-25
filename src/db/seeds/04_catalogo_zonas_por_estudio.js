const TODAS_LAS_ZONAS = [
  'craneo',
  'cuello',
  'cervical',
  'toracica_columna',
  'lumbar',
  'torax',
  'abdomen',
  'pelvis',
  'miembro_toracico',
  'miembro_pelvico',
  'ocular',
  'dental',
  'articular',
];

const configuracion = [
  ['Imagenología', 'Radiografía simple', TODAS_LAS_ZONAS.filter((codigo) => codigo !== 'ocular')],
  [
    'Imagenología',
    'Radiografía de contraste',
    ['cuello', 'cervical', 'toracica_columna', 'lumbar', 'torax', 'abdomen', 'pelvis', 'articular'],
  ],
  [
    'Imagenología',
    'Ultrasonido',
    [
      'cuello',
      'torax',
      'abdomen',
      'pelvis',
      'miembro_toracico',
      'miembro_pelvico',
      'ocular',
      'articular',
    ],
  ],
  [
    'Imagenología',
    'Ultrasonido Doppler',
    ['cuello', 'torax', 'abdomen', 'pelvis', 'miembro_toracico', 'miembro_pelvico', 'ocular'],
  ],
  ['Imagenología', 'POCUS', ['torax', 'abdomen', 'pelvis']],
  ['Imagenología', 'Tomografía computarizada — CT/TAC', TODAS_LAS_ZONAS],
  ['Imagenología', 'TAC con contraste', TODAS_LAS_ZONAS],
  ['Imagenología', 'Angio-TAC', TODAS_LAS_ZONAS],
  ['Imagenología', 'Resonancia magnética — MRI/RM', TODAS_LAS_ZONAS],
  ['Imagenología', 'Resonancia con contraste', TODAS_LAS_ZONAS],
  ['Imagenología', 'Gammagrafía / medicina nuclear', TODAS_LAS_ZONAS],
  ['Imagenología', 'PET/CT', TODAS_LAS_ZONAS],
  [
    'Ortopedia y musculoesquelético',
    'Radiografía ortopédica',
    [
      'cervical',
      'toracica_columna',
      'lumbar',
      'pelvis',
      'miembro_toracico',
      'miembro_pelvico',
      'articular',
    ],
  ],
  [
    'Ortopedia y musculoesquelético',
    'TAC musculoesquelética',
    [
      'cervical',
      'toracica_columna',
      'lumbar',
      'pelvis',
      'miembro_toracico',
      'miembro_pelvico',
      'articular',
    ],
  ],
  [
    'Ortopedia y musculoesquelético',
    'Resonancia musculoesquelética',
    [
      'cervical',
      'toracica_columna',
      'lumbar',
      'pelvis',
      'miembro_toracico',
      'miembro_pelvico',
      'articular',
    ],
  ],
];

exports.seed = async function seed(knex) {
  const categorias = await knex('catalogo_categorias_estudio').select('id', 'nombre');
  const categoriaIdPorNombre = new Map(
    categorias.map((categoria) => [categoria.nombre, categoria.id]),
  );
  const zonas = await knex('catalogo_zonas_anatomicas').select('id', 'codigo');
  const zonaIdPorCodigo = new Map(zonas.map((zona) => [zona.codigo, zona.id]));

  const filas = [];
  const estudioIds = new Set();
  for (const [categoria, nombre, codigosZona] of configuracion) {
    const estudio = await knex('catalogo_estudios')
      .where({ categoria_id: categoriaIdPorNombre.get(categoria), nombre, activo: true })
      .first('id');
    if (!estudio) throw new Error(`No existe el estudio activo ${categoria} / ${nombre}`);
    estudioIds.add(estudio.id);
    for (const codigo of codigosZona) {
      const zonaId = zonaIdPorCodigo.get(codigo);
      if (!zonaId) throw new Error(`No existe la zona anatómica ${codigo}`);
      filas.push({ estudio_id: estudio.id, zona_anatomica_id: zonaId });
    }
  }

  await knex('catalogo_estudio_zonas')
    .whereIn('estudio_id', [...estudioIds])
    .del();
  if (filas.length) await knex('catalogo_estudio_zonas').insert(filas);
};

exports.TODAS_LAS_ZONAS = TODAS_LAS_ZONAS;
exports.CONFIGURACION = configuracion;
