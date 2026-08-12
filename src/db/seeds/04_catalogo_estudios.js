const estudiosPorCategoria = {
  Hematología: [
    ['BH', 'Biometría hemática completa'],
    ['FROTIS', 'Frotis sanguíneo'],
    ['COAG', 'Tiempo de coagulación (TP, TTPa)'],
    ['GRUPO_SANG', 'Grupo sanguíneo'],
    ['RETICULOCITOS', 'Reticulocitos'],
    ['VSG', 'Velocidad de sedimentación globular'],
  ],
  'Bioquímica sanguínea': [
    ['RENAL', 'Perfil renal (BUN/urea, creatinina, fósforo)'],
    ['HEPATICO', 'Perfil hepático (ALT, AST, FA, bilirrubinas, albúmina)'],
    ['GLUCOSA', 'Glucosa'],
    ['ELECTROLITOS', 'Electrolitos (sodio, potasio, cloro)'],
    ['LIPIDICO', 'Perfil lipídico (colesterol, triglicéridos)'],
    ['AMILASA_LIPASA', 'Amilasa y lipasa (pancreatitis)'],
    ['PROTEINAS', 'Proteínas totales y fraccionadas'],
    ['ACIDOS_BILIARES', 'Ácidos biliares'],
    ['AMONIACO', 'Amoniaco'],
    ['CK', 'Creatín cinasa (CK)'],
    ['LDH', 'Deshidrogenasa láctica (LDH)'],
    ['CALCIO', 'Calcio y calcio ionizado'],
    ['MAGNESIO', 'Magnesio'],
    ['GASOMETRIA', 'Gasometría / equilibrio ácido-base'],
  ],
  Endocrinología: [
    ['T4_TSH', 'T4 y TSH (tiroides)'],
    ['CORTISOL_ACTH', 'Cortisol basal y estimulación con ACTH'],
    ['FRUCTOSAMINA', 'Fructosamina (control de diabetes)'],
    ['PROGESTERONA', 'Progesterona (ciclo reproductivo)'],
    ['INSULINA_BASAL', 'Insulina basal'],
    ['CURVA_GLUCOSA', 'Curva de glucosa'],
    ['PANEL_ADDISON', 'Panel de Addison completo'],
    ['AMH', 'Hormona antimülleriana (AMH)'],
  ],
  Orina: [
    ['EGO', 'Examen general de orina'],
    ['UROCULTIVO', 'Urocultivo con antibiograma'],
    ['UPC', 'Relación proteína/creatinina urinaria'],
    ['CORT_CREAT_URINARIA', 'Cortisol/creatinina urinaria'],
  ],
  Heces: [
    ['COPROPARASITOSCOPICO', 'Coproparasitoscópico'],
    ['COPROCULTIVO', 'Coprocultivo'],
    ['SANGRE_OCULTA', 'Prueba de moco/sangre oculta en heces'],
    ['AG_GIARDIA_PARVO_PANLEUCO', 'Antígeno Giardia/Parvovirus/Panleucopenia'],
  ],
  'Serología - Perros': [
    ['PARVOVIRUS_CANINO', 'Parvovirus canino'],
    ['MOQUILLO', 'Moquillo canino'],
    ['EHRLICHIA_ANAPLASMA', 'Ehrlichia / Anaplasma'],
    ['LEISHMANIA', 'Leishmania'],
    ['DIROFILARIA', 'Dirofilaria (gusano del corazón)'],
    ['BRUCELLA_CANINA', 'Brucella canina'],
    ['LEPTOSPIRA', 'Leptospira'],
    ['TEST_4DX', 'Test 4Dx combinado (Dirofilaria/Ehrlichia/Anaplasma/Lyme)'],
    ['LYME_BORRELIA', 'Enfermedad de Lyme (Borrelia)'],
  ],
  'Serología - Gatos': [
    ['FELV', 'Leucemia felina (FeLV)'],
    ['FIV', 'Inmunodeficiencia felina (FIV)'],
    ['PANLEUCOPENIA_FELINA', 'Panleucopenia felina'],
    ['PIF_FIP', 'Peritonitis infecciosa felina (PIF/FIP)'],
    ['TOXOPLASMA', 'Toxoplasma'],
    ['MICOPLASMA_HEMOFELINO', 'Micoplasma hemofelino'],
  ],
  'Citología e histopatología': [
    ['CITOLOGIA_PIEL_OIDOS', 'Citología de piel/oídos'],
    ['PAAF', 'Citología por aspiración con aguja fina'],
    ['BIOPSIA_HISTOPATOLOGIA', 'Biopsia con estudio histopatológico'],
    ['CULTIVO_HONGOS', 'Cultivo de hongos (dermatofitosis)'],
    ['CULTIVO_BACTERIANO', 'Cultivo bacteriano con antibiograma'],
    ['RASPADO_PROFUNDO', 'Raspado cutáneo profundo (sarna demodécica)'],
  ],
  Imagenología: [
    ['RADIOGRAFIA', 'Radiografía simple', true],
    ['ECOGRAFIA', 'Ecografía', true],
    ['ECOCARDIOGRAMA', 'Ecocardiograma'],
    ['ECG', 'Electrocardiograma (ECG)'],
    ['TAC', 'Tomografía computarizada'],
    ['ENDOSCOPIA', 'Endoscopía'],
  ],
  'Genética y reproducción': [
    ['PERFIL_GESTACION', 'Perfil de gestación'],
    ['ESPERMATOBIOSCOPIA', 'Espermatobioscopía'],
    ['GENETICA_RAZA', 'Pruebas genéticas de raza'],
  ],
};

exports.seed = async function seed(knex) {
  await knex('catalogo_estudios').del();

  const categorias = await knex('catalogo_categorias_estudio').select('id', 'nombre');
  const categoriaIdPorNombre = Object.fromEntries(categorias.map((c) => [c.nombre, c.id]));

  const rows = Object.entries(estudiosPorCategoria).flatMap(([categoriaNombre, estudios]) =>
    estudios.map(([codigo, nombre, requiereZona = false]) => ({
      categoria_id: categoriaIdPorNombre[categoriaNombre],
      codigo,
      nombre,
      requiere_zona: requiereZona,
    })),
  );

  await knex('catalogo_estudios').insert(rows);
};
