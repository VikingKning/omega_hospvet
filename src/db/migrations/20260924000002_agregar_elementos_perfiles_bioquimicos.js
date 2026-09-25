const CAMBIOS = [
  {
    codigo: 'PERFIL_BASICO',
    nombreAnterior: 'Perfil bioquímico básico',
    nombreNuevo: 'Perfil bioquímico básico (6 elementos)',
  },
  {
    codigo: 'PERFIL_GENERAL',
    nombreAnterior: 'Perfil bioquímico general',
    nombreNuevo: 'Perfil bioquímico general (12 elementos)',
  },
  {
    codigo: 'PERFIL_INTEGRAL',
    nombreAnterior: 'Perfil bioquímico completo',
    nombreNuevo: 'Perfil bioquímico completo (24 elementos)',
  },
];

exports.up = async function up(knex) {
  for (const { codigo, nombreNuevo } of CAMBIOS) {
    await knex('catalogo_estudios').where({ codigo }).update({ nombre: nombreNuevo });
  }
};

exports.down = async function down(knex) {
  for (const { codigo, nombreAnterior } of CAMBIOS) {
    await knex('catalogo_estudios').where({ codigo }).update({ nombre: nombreAnterior });
  }
};

exports.CAMBIOS = CAMBIOS;
