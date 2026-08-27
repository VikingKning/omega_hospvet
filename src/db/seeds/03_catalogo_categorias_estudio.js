// Catálogo completo de laboratorio (pedido explícito del usuario, estilo
// "catálogo de hospital veterinario" — no limitado a lo que la clínica
// hace en sitio, es un catálogo de referencia). 33 categorías; reemplaza
// a las 10 anteriores (más chicas). Orden preservado del mockup que mandó
// el usuario, con una corrección de nombre ("Microbiología" -> el nombre
// que ya usaba tanto este catálogo como la lista original de referencia:
// "Bacteriología").
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
  await knex('catalogo_estudios').del();
  await knex('catalogo_categorias_estudio').del();
  await knex('catalogo_categorias_estudio').insert(categorias.map((nombre) => ({ nombre })));
};
