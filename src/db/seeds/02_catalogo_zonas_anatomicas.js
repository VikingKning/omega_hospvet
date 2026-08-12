const zonas = [
  ['craneo', 'Cráneo'],
  ['cervical', 'Columna cervical'],
  ['toracica_columna', 'Columna torácica'],
  ['lumbar', 'Columna lumbar'],
  ['torax', 'Tórax'],
  ['abdomen', 'Abdomen'],
  ['pelvis', 'Pelvis'],
  ['miembro_toracico', 'Miembro torácico'],
  ['miembro_pelvico', 'Miembro pélvico'],
  ['ocular', 'Ocular'],
  ['articular', 'Articular'],
];

exports.seed = async function seed(knex) {
  await knex('catalogo_zonas_anatomicas').del();
  await knex('catalogo_zonas_anatomicas').insert(
    zonas.map(([codigo, nombre]) => ({ codigo, nombre })),
  );
};
