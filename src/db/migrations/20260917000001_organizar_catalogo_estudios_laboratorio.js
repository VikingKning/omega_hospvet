const ESTUDIOS_NUEVOS = [
  ['Perfiles clínicos / Paneles', 'PERRO_FUNCION_RENAL', 'Función renal', null, 'Perro'],
  ['Perfiles clínicos / Paneles', 'PERRO_PERFIL_METABOLICO', 'Perfil metabólico', null, 'Perro'],
  ['Química sanguínea / Bioquímica', 'PERRO_ALKP', 'ALKP / Fosfatasa alcalina', null, 'Perro'],
  ['Uroanálisis', 'PERRO_UROANALISIS_COMPLETO', 'Uroanálisis completo', null, 'Perro'],
  ['Parasitología', 'PERRO_COPROLOGICO_FLOTACION', 'Coprológico por flotación', null, 'Perro'],
  [
    'Parasitología',
    'PERRO_COPROLOGICO_FUNCIONAL',
    'Coprológico funcional / digestivo',
    null,
    'Perro',
  ],
  ['Citología', 'PERRO_CITOLOGIA_PIEL', 'Citología de piel', 'tejido_lateralidad', 'Perro'],
  ['Citología', 'PERRO_PAF', 'Punción con aguja fina (PAF)', 'tejido_lateralidad', 'Perro'],
  ['Hematología', 'GATO_FROTIS_SANGUINEO', 'Frotis sanguíneo felino', null, 'Gato'],
  ['Química sanguínea / Bioquímica', 'GATO_ALKP', 'ALKP / Fosfatasa alcalina', null, 'Gato'],
  ['Cardiología', 'GATO_CARDIOPET_PROBNP', 'Cardiopet proBNP felino', null, 'Gato'],
  [
    'Uroanálisis',
    'GATO_UROANALISIS_CISTOCENTESIS',
    'Uroanálisis completo (cistocentesis)',
    null,
    'Gato',
  ],
  ['Parasitología', 'GATO_COPROLOGICO_FLOTACION', 'Coprológico por flotación', null, 'Gato'],
  [
    'Parasitología',
    'GATO_COPROLOGICO_EXTENSION_DIRECTA',
    'Coprológico por extensión directa',
    null,
    'Gato',
  ],
  [
    'Perfiles clínicos / Paneles',
    'GATO_PERFIL_RESPIRATORIO',
    'Perfil respiratorio felino',
    null,
    'Gato',
  ],
  ['Citología', 'GATO_CITOLOGIA_RASPADO_OREJA', 'Citología de raspado de oreja', null, 'Gato'],
  [
    'Citología',
    'GATO_PAF_MASAS_HEPATICAS',
    'Punción con aguja fina (PAF) de masas hepáticas',
    null,
    'Gato',
  ],
  [
    'Citología',
    'GATO_PAF_NODULOS_TIROIDEOS',
    'Punción con aguja fina (PAF) de nódulos tiroideos',
    null,
    'Gato',
  ],
  [
    'Enfermedades infecciosas - Gato',
    'GATO_PCR_VILEF_VIF',
    'PCR para ViLeF/VIF (FeLV/FIV)',
    null,
    'Gato',
  ],
  ['Enfermedades infecciosas - Gato', 'GATO_PCR_HEMOPLASMAS', 'PCR para hemoplasmas', null, 'Gato'],
];

const RADIOGRAFIAS_REDUNDANTES = [
  'Radiografía torácica',
  'Radiografía abdominal',
  'Radiografía de columna',
  'Radiografía de extremidades',
  'Radiografía de cráneo',
  'Radiografía dental',
  'Serie radiográfica',
];

const ULTRASONIDOS_REDUNDANTES = [
  'Ultrasonido abdominal',
  'Ultrasonido torácico',
  'Ultrasonido ocular',
  'Ultrasonido musculoesquelético',
];

const ESTUDIOS_CON_DESTINO_EXPLICITO = [
  'Electrocardiograma — ECG',
  'ECG de 6 derivaciones',
  'Ecocardiograma',
  'Ecocardiograma Doppler',
  'Doppler color',
  'Esofagograma',
  'Tránsito gastrointestinal',
  'Colon por contraste',
  'Urografía excretora',
  'Cistografía',
  'Uretrografía',
  'Fistulografía',
  'Mielografía',
  'Ultrasonido gestacional',
  'Ecografía FAST / AFAST',
  'Ecografía TFAST',
  'Resonancia magnética cerebral',
  'Resonancia de columna',
  'Tomografía cerebral',
  'Radiografía torácica',
  'TAC torácica',
  'Radiografía gestacional',
  'Ultrasonido prostático',
  'Ultrasonido ocular',
  'TAC de oído medio/interno',
  'Radiografía dental intraoral',
  'Serie radiográfica dental completa',
  'TAC maxilofacial',
];

async function obtenerCategorias(knex) {
  const categorias = await knex('catalogo_categorias_estudio').select('id', 'nombre');
  return new Map(categorias.map((categoria) => [categoria.nombre, categoria.id]));
}

async function guardarEstudios(knex, categorias) {
  for (const [categoria, codigo, nombre, campoAdicional, especie] of ESTUDIOS_NUEVOS) {
    const categoriaId = categorias.get(categoria);
    if (!categoriaId) throw new Error(`No existe la categoría de laboratorio: ${categoria}`);
    await knex('catalogo_estudios')
      .insert({
        categoria_id: categoriaId,
        codigo,
        nombre,
        campo_adicional: campoAdicional,
        especie,
        activo: true,
      })
      .onConflict('codigo')
      .merge({
        categoria_id: categoriaId,
        nombre,
        campo_adicional: campoAdicional,
        especie,
        activo: true,
      });
  }
}

exports.up = async function up(knex) {
  const categorias = await obtenerCategorias(knex);
  // En instalaciones nuevas los catálogos se cargan mediante seeds después de
  // ejecutar todas las migraciones. No hay datos históricos que transformar.
  if (categorias.size === 0) return;

  const imagenologiaId = categorias.get('Imagenología');
  const infecciosasGatoId = categorias.get('Enfermedades infecciosas - Gato');
  if (!imagenologiaId || !infecciosasGatoId) {
    throw new Error('Faltan categorías obligatorias del catálogo de laboratorio.');
  }

  await knex('catalogo_zonas_anatomicas')
    .insert({ codigo: 'dental', nombre: 'Dental' })
    .onConflict('codigo')
    .merge({ nombre: 'Dental' });

  await knex('catalogo_estudios')
    .where({ categoria_id: imagenologiaId })
    .whereIn('nombre', [...RADIOGRAFIAS_REDUNDANTES, ...ULTRASONIDOS_REDUNDANTES])
    .update({ activo: false });

  await knex('catalogo_estudios')
    .where({ categoria_id: imagenologiaId, nombre: 'Radiografía con contraste' })
    .update({ nombre: 'Radiografía de contraste', campo_adicional: 'zona', activo: true });

  await knex('catalogo_estudios')
    .where({ categoria_id: imagenologiaId, nombre: 'Radiografía simple' })
    .update({ campo_adicional: 'zona', activo: true });

  await knex('catalogo_estudios')
    .insert({
      categoria_id: imagenologiaId,
      codigo: 'IMAGENOLOGIA_ULTRASONIDO',
      nombre: 'Ultrasonido',
      campo_adicional: 'zona',
      especie: null,
      activo: true,
    })
    .onConflict('codigo')
    .merge({
      categoria_id: imagenologiaId,
      nombre: 'Ultrasonido',
      campo_adicional: 'zona',
      especie: null,
      activo: true,
    });

  await knex('catalogo_estudios')
    .whereIn('nombre', ESTUDIOS_CON_DESTINO_EXPLICITO)
    .update({ campo_adicional: null });

  await knex('catalogo_estudios')
    .where({ categoria_id: imagenologiaId, nombre: 'Ultrasonido Doppler' })
    .update({ campo_adicional: 'zona', activo: true });

  await knex('catalogo_estudios')
    .where({ nombre: 'Fosfatasa alcalina / ALP' })
    .update({ activo: false });

  await knex('catalogo_estudios')
    .where({ categoria_id: infecciosasGatoId, nombre: 'Prueba combinada FeLV/FIV' })
    .update({ nombre: 'Prueba rápida ViLeF/VIF (FeLV/FIV)', especie: 'Gato', activo: true });

  await guardarEstudios(knex, categorias);
};

exports.down = async function down(knex) {
  const categorias = await obtenerCategorias(knex);
  const imagenologiaId = categorias.get('Imagenología');
  const infecciosasGatoId = categorias.get('Enfermedades infecciosas - Gato');

  await knex('catalogo_estudios')
    .whereIn(
      'codigo',
      ESTUDIOS_NUEVOS.map((estudio) => estudio[1]).concat('IMAGENOLOGIA_ULTRASONIDO'),
    )
    .update({ activo: false });

  if (imagenologiaId) {
    await knex('catalogo_estudios')
      .where({ categoria_id: imagenologiaId })
      .whereIn('nombre', [...RADIOGRAFIAS_REDUNDANTES, ...ULTRASONIDOS_REDUNDANTES])
      .update({ activo: true, campo_adicional: 'zona' });

    await knex('catalogo_estudios')
      .where({ categoria_id: imagenologiaId, nombre: 'Radiografía de contraste' })
      .update({ nombre: 'Radiografía con contraste', campo_adicional: 'zona', activo: true });
  }

  await knex('catalogo_estudios')
    .whereIn('nombre', ESTUDIOS_CON_DESTINO_EXPLICITO)
    .update({ campo_adicional: 'zona' });

  await knex('catalogo_estudios')
    .where({ nombre: 'Fosfatasa alcalina / ALP' })
    .update({ activo: true });

  if (infecciosasGatoId) {
    await knex('catalogo_estudios')
      .where({
        categoria_id: infecciosasGatoId,
        nombre: 'Prueba rápida ViLeF/VIF (FeLV/FIV)',
      })
      .whereNot({ codigo: 'GATO_PCR_VILEF_VIF' })
      .update({ nombre: 'Prueba combinada FeLV/FIV' });
  }
};
