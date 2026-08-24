// Ajuste posterior, pedido explícito del usuario: el formato NN-NNNN-NNNN
// (máscara mientras se escribe, mismo patrón ya establecido en
// tutores/usuarios/perfil) solo debe aplicar para el look and feel — lo que
// se GUARDA en la base debe ser el teléfono sin guiones (solo dígitos). Esta
// migración de datos normaliza lo que ya existe; de aquí en adelante,
// tutores.service.js#validateTelefono / usuarios.service.js#parseTelefono /
// perfil.service.js#validateTelefono quitan los guiones antes de guardar, y
// cada servicio reconstruye el formato NN-NNNN-NNNN solo al devolver datos
// para mostrarlos (listados, formularios precargados, el buscador de
// tutores).
//
// regexp_replace(telefono, '\D', '', 'g') es un no-op sobre un valor que ya
// solo tiene dígitos, así que corre sin riesgo de romper nada aunque se
// vuelva a aplicar dos veces.
exports.up = async function up(knex) {
  await knex.raw(`UPDATE propietarios SET telefono = regexp_replace(telefono, '\\D', '', 'g')`);
  await knex.raw(
    `UPDATE usuarios SET telefono = regexp_replace(telefono, '\\D', '', 'g') WHERE telefono IS NOT NULL`,
  );
};

// Reversible de verdad (a diferencia de otras migraciones de datos de este
// proyecto): un teléfono de exactamente 10 dígitos siempre puede
// reconstruirse a NN-NNNN-NNNN sin ambigüedad. El filtro `~ '^[0-9]{10}$'`
// evita tocar cualquier valor que no tenga esa forma (NULL, o algo que ya
// se hubiera guardado distinto por fuera de este flujo).
exports.down = async function down(knex) {
  await knex.raw(`
    UPDATE propietarios
    SET telefono = substring(telefono from 1 for 2) || '-' || substring(telefono from 3 for 4) || '-' || substring(telefono from 7 for 4)
    WHERE telefono ~ '^[0-9]{10}$'
  `);
  await knex.raw(`
    UPDATE usuarios
    SET telefono = substring(telefono from 1 for 2) || '-' || substring(telefono from 3 for 4) || '-' || substring(telefono from 7 for 4)
    WHERE telefono ~ '^[0-9]{10}$'
  `);
};
