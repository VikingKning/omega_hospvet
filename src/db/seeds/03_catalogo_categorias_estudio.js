const categorias = [
  'Hematología',
  'Química sanguínea / Bioquímica',
  'Electrolitos, minerales y ácido-base',
  'Uroanálisis',
  'Coagulación y hemostasia',
  'Endocrinología',
  'Enfermedades infecciosas - Perro',
  'Enfermedades infecciosas - Gato',
  'Parasitología',
  'Bacteriología',
  'Micología',
  'Dermatología',
  'Citología',
  'Anatomía patológica',
  'Oncología y diagnóstico molecular',
  'Cardiología',
  'Imagenología',
  'Neurología',
  'Gastroenterología',
  'Sistema respiratorio',
  'Reproducción',
  'Oftalmología',
  'Otología',
  'Ortopedia y musculoesquelético',
  'Inmunología y autoinmunes',
  'Toxicología',
  'Banco de sangre / Medicina transfusional',
  'Genética',
  'Análisis de líquidos corporales',
  'Monitorización de fármacos',
  'Odontología',
  'Perfiles clínicos / Paneles',
  'Procedimientos diagnósticos',
];

exports.seed = async function seed(knex) {
  await knex('catalogo_categorias_estudio')
    .insert(categorias.map((nombre) => ({ nombre, activo: true })))
    .onConflict('nombre')
    .merge({ activo: true });
};

exports.CATEGORIAS = categorias;
