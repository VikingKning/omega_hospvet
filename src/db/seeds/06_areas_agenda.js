// US-604 (cuarta iteración): el tab "Agendas" de la matriz de permisos de
// usuarios (usuarios.service.js#construirMatrizPermisos) lee sus filas en
// vivo de la tabla `areas` (pedido explícito del usuario: "estos valores se
// deben de obtener de la tabla de areas"), emparejando cada área activa por
// slug contra los permisos `agenda.<slug>.*` ya sembrados en
// 01_permissions.js. Este seed pre-carga las 8 áreas que el usuario dio
// (3 tipos de cita + 5 especialidades médicas) para que existan desde el
// arranque — sin esto, el tab Agendas no tendría ninguna fila hasta que
// alguien las diera de alta a mano desde Catálogo de Áreas. Los slugs
// deben coincidir EXACTO con los usados en 01_permissions.js
// (AGENDA_CATEGORIAS) — si no coinciden, el área existe pero no muestra
// ningún checkbox (backstop silencioso en construirTabAgendas).
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
    // Idempotente por slug (único de verdad, nunca se regenera) — si ya
    // existe (activa o no) se deja como está, nunca se fuerza a reactivar
    // ni se pisa un nombre que el cliente ya haya editado a mano.
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
