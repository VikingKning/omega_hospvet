const ESTUDIOS_NO_CANONICOS = [
  ['Hematología', 'Fibrinógeno'],
  ['Uroanálisis', 'Cortisol/creatinina urinaria'],
  ['Enfermedades infecciosas - Gato', 'Cryptosporidium PCR'],
  ['Enfermedades infecciosas - Gato', 'Giardia PCR'],
  ['Enfermedades infecciosas - Perro', 'Panel de donador sanguíneo canino'],
  ['Enfermedades infecciosas - Gato', 'Panel de donador sanguíneo felino'],
  ['Dermatología', 'Citología cutánea'],
  ['Dermatología', 'Citología ótica'],
  ['Dermatología', 'Cultivo micológico'],
  ['Oncología y diagnóstico molecular', 'Biopsia de médula ósea'],
  ['Neurología', 'Análisis de líquido cefalorraquídeo'],
  ['Neurología', 'Anticuerpos contra receptor de acetilcolina'],
  ['Neurología', 'Mielografía'],
  ['Gastroenterología', 'Colonoscopia'],
  ['Gastroenterología', 'Cultivo fecal'],
  ['Gastroenterología', 'Gastroscopia'],
  ['Sistema respiratorio', 'Broncoscopia'],
  ['Sistema respiratorio', 'Gasometría arterial'],
  ['Sistema respiratorio', 'Panel respiratorio canino'],
  ['Sistema respiratorio', 'Panel respiratorio felino'],
  ['Sistema respiratorio', 'Rinoscopia'],
  ['Reproducción', 'Citología vaginal'],
  ['Reproducción', 'Estradiol'],
  ['Reproducción', 'LH'],
  ['Reproducción', 'Progesterona'],
  ['Reproducción', 'Testosterona'],
  ['Reproducción', 'Ultrasonido gestacional'],
  ['Oftalmología', 'Citología conjuntival'],
  ['Oftalmología', 'Cultivo ocular'],
  ['Otología', 'Antibiograma'],
  ['Otología', 'Citología ótica'],
  ['Otología', 'Otoscopia'],
  ['Otología', 'Videootoscopia'],
  ['Ortopedia y musculoesquelético', 'Análisis de líquido sinovial'],
  ['Ortopedia y musculoesquelético', 'Artrocentesis'],
  ['Ortopedia y musculoesquelético', 'Artroscopia'],
  ['Ortopedia y musculoesquelético', 'Citología de líquido sinovial'],
  ['Ortopedia y musculoesquelético', 'Cultivo de líquido sinovial'],
];

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

const ZONAS_POR_ESTUDIO = new Map([
  ['Imagenología::Radiografía simple', TODAS_LAS_ZONAS.filter((codigo) => codigo !== 'ocular')],
  [
    'Imagenología::Radiografía de contraste',
    ['cuello', 'cervical', 'toracica_columna', 'lumbar', 'torax', 'abdomen', 'pelvis', 'articular'],
  ],
  [
    'Imagenología::Ultrasonido',
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
    'Imagenología::Ultrasonido Doppler',
    ['cuello', 'torax', 'abdomen', 'pelvis', 'miembro_toracico', 'miembro_pelvico', 'ocular'],
  ],
  ['Imagenología::POCUS', ['torax', 'abdomen', 'pelvis']],
  ['Imagenología::Tomografía computarizada — CT/TAC', TODAS_LAS_ZONAS],
  ['Imagenología::TAC con contraste', TODAS_LAS_ZONAS],
  ['Imagenología::Angio-TAC', TODAS_LAS_ZONAS],
  ['Imagenología::Resonancia magnética — MRI/RM', TODAS_LAS_ZONAS],
  ['Imagenología::Resonancia con contraste', TODAS_LAS_ZONAS],
  ['Imagenología::Gammagrafía / medicina nuclear', TODAS_LAS_ZONAS],
  ['Imagenología::PET/CT', TODAS_LAS_ZONAS],
  [
    'Ortopedia y musculoesquelético::Radiografía ortopédica',
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
    'Ortopedia y musculoesquelético::TAC musculoesquelética',
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
    'Ortopedia y musculoesquelético::Resonancia musculoesquelética',
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
]);

async function idCategoria(knex, nombre) {
  const categoria = await knex('catalogo_categorias_estudio').where({ nombre }).first('id');
  if (!categoria) throw new Error(`No existe la categoría de laboratorio: ${nombre}`);
  return categoria.id;
}

async function actualizarEstudio(knex, categoria, nombre, cambios) {
  const categoriaId = await idCategoria(knex, categoria);
  await knex('catalogo_estudios').where({ categoria_id: categoriaId, nombre }).update(cambios);
}

async function poblarZonasPermitidas(knex) {
  const zonas = await knex('catalogo_zonas_anatomicas').select('id', 'codigo');
  const zonaIdPorCodigo = new Map(zonas.map((zona) => [zona.codigo, zona.id]));
  const estudios = await knex('catalogo_estudios as e')
    .join('catalogo_categorias_estudio as c', 'c.id', 'e.categoria_id')
    .where({ 'e.activo': true, 'e.campo_adicional': 'zona' })
    .select('e.id', 'e.nombre', 'c.nombre as categoria');

  const filas = [];
  for (const estudio of estudios) {
    const clave = `${estudio.categoria}::${estudio.nombre}`;
    const codigos = ZONAS_POR_ESTUDIO.get(clave);
    if (!codigos) throw new Error(`Faltan zonas permitidas para ${clave}`);
    for (const codigo of codigos) {
      const zonaId = zonaIdPorCodigo.get(codigo);
      if (!zonaId) throw new Error(`No existe la zona anatómica: ${codigo}`);
      filas.push({ estudio_id: estudio.id, zona_anatomica_id: zonaId });
    }
  }

  if (filas.length) {
    await knex('catalogo_estudio_zonas').insert(filas).onConflict().ignore();
  }
}

exports.up = async function up(knex) {
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.boolean('permite_antibiograma').notNullable().defaultTo(false);
  });
  await knex.raw(`
    ALTER TABLE catalogo_estudios
      ADD CONSTRAINT catalogo_estudios_especie_check
      CHECK (especie IS NULL OR especie IN ('Perro', 'Gato'));
  `);
  await knex.raw(`
    ALTER TABLE catalogo_estudios
      ADD CONSTRAINT catalogo_estudios_campo_adicional_check
      CHECK (
        campo_adicional IS NULL OR campo_adicional IN (
          'zona', 'tipo_muestra', 'tejido_lateralidad', 'componentes_liquido'
        )
      );
  `);
  await knex.schema.createTable('catalogo_estudio_zonas', (table) => {
    table.integer('estudio_id').notNullable();
    table.integer('zona_anatomica_id').notNullable();
    table.primary(['estudio_id', 'zona_anatomica_id']);
    table.foreign('estudio_id').references('catalogo_estudios.id').onDelete('CASCADE');
    table
      .foreign('zona_anatomica_id')
      .references('catalogo_zonas_anatomicas.id')
      .onDelete('RESTRICT');
  });

  await knex('catalogo_zonas_anatomicas')
    .insert({ codigo: 'cuello', nombre: 'Cuello' })
    .onConflict('codigo')
    .merge({ nombre: 'Cuello' });

  await knex('catalogo_estudios')
    .where({ codigo: 'GATO_UROANALISIS_CISTOCENTESIS' })
    .update({ nombre: 'Uroanálisis completo' });
  await actualizarEstudio(knex, 'Electrolitos, minerales y ácido-base', 'Hierro', {
    nombre: 'Hierro sérico',
  });
  await actualizarEstudio(knex, 'Electrolitos, minerales y ácido-base', 'Cobre', {
    nombre: 'Cobre sérico',
  });
  await actualizarEstudio(knex, 'Electrolitos, minerales y ácido-base', 'Zinc', {
    nombre: 'Zinc sérico',
  });
  await actualizarEstudio(knex, 'Uroanálisis', 'Glucosa', { nombre: 'Glucosa urinaria' });
  await actualizarEstudio(knex, 'Toxicología', 'Hierro', {
    nombre: 'Hierro — análisis toxicológico',
  });
  await actualizarEstudio(knex, 'Toxicología', 'Cobre', {
    nombre: 'Cobre — análisis toxicológico',
  });
  await actualizarEstudio(knex, 'Toxicología', 'Zinc', {
    nombre: 'Zinc — análisis toxicológico',
  });
  await actualizarEstudio(knex, 'Bacteriología', 'Antibiograma', {
    campo_adicional: 'tipo_muestra',
  });

  await knex('catalogo_estudios')
    .whereIn('nombre', [
      'Análisis toxicológico de contenido gástrico',
      'Análisis toxicológico de hígado',
      'Análisis toxicológico de sangre',
      'Análisis toxicológico de orina',
    ])
    .update({ campo_adicional: null });

  await knex('catalogo_estudios').update({ permite_antibiograma: false });
  await knex('catalogo_estudios')
    .where({ campo_adicional: 'tipo_muestra' })
    .whereRaw("nombre ~* '^(cultivo|urocultivo|hemocultivo)'")
    .whereRaw("nombre !~* '(micológico|hongos)'")
    .update({ permite_antibiograma: true });

  for (const [categoria, nombre] of ESTUDIOS_NO_CANONICOS) {
    await actualizarEstudio(knex, categoria, nombre, { activo: false });
  }

  await poblarZonasPermitidas(knex);
};

exports.down = async function down(knex) {
  for (const [categoria, nombre] of ESTUDIOS_NO_CANONICOS) {
    await actualizarEstudio(knex, categoria, nombre, { activo: true });
  }

  await knex('catalogo_estudios')
    .where({ codigo: 'GATO_UROANALISIS_CISTOCENTESIS' })
    .update({ nombre: 'Uroanálisis completo (cistocentesis)' });
  await actualizarEstudio(knex, 'Electrolitos, minerales y ácido-base', 'Hierro sérico', {
    nombre: 'Hierro',
  });
  await actualizarEstudio(knex, 'Electrolitos, minerales y ácido-base', 'Cobre sérico', {
    nombre: 'Cobre',
  });
  await actualizarEstudio(knex, 'Electrolitos, minerales y ácido-base', 'Zinc sérico', {
    nombre: 'Zinc',
  });
  await actualizarEstudio(knex, 'Uroanálisis', 'Glucosa urinaria', { nombre: 'Glucosa' });
  await actualizarEstudio(knex, 'Toxicología', 'Hierro — análisis toxicológico', {
    nombre: 'Hierro',
  });
  await actualizarEstudio(knex, 'Toxicología', 'Cobre — análisis toxicológico', {
    nombre: 'Cobre',
  });
  await actualizarEstudio(knex, 'Toxicología', 'Zinc — análisis toxicológico', {
    nombre: 'Zinc',
  });
  await actualizarEstudio(knex, 'Bacteriología', 'Antibiograma', { campo_adicional: null });
  await knex('catalogo_estudios')
    .whereIn('nombre', [
      'Análisis toxicológico de contenido gástrico',
      'Análisis toxicológico de hígado',
      'Análisis toxicológico de sangre',
      'Análisis toxicológico de orina',
    ])
    .update({ campo_adicional: 'tipo_muestra' });

  await knex.schema.dropTable('catalogo_estudio_zonas');
  await knex.raw(
    'ALTER TABLE catalogo_estudios DROP CONSTRAINT catalogo_estudios_campo_adicional_check',
  );
  await knex.raw('ALTER TABLE catalogo_estudios DROP CONSTRAINT catalogo_estudios_especie_check');
  await knex.schema.alterTable('catalogo_estudios', (table) => {
    table.dropColumn('permite_antibiograma');
  });
};
