const db = require('../../config/database');

async function obtenerValores(claves) {
  const filas = await db('configuracion_sistema').whereIn('clave', claves);
  const mapa = new Map(filas.map((fila) => [fila.clave, fila]));
  return claves.map((clave) => mapa.get(clave) ?? null);
}

async function guardarValores(valores, usuarioId, trx) {
  const conexion = trx ?? db;
  for (const { clave, valor, descripcion } of valores) {
    await conexion('configuracion_sistema')
      .insert({
        clave,
        valor,
        descripcion,
        actualizado_por: usuarioId,
        actualizado_en: conexion.fn.now(),
      })
      .onConflict('clave')
      .merge(['valor', 'descripcion', 'actualizado_por', 'actualizado_en']);
  }
}

async function insertarVersionAviso({ version, nombreArchivo, nombreOriginal, usuarioId }, trx) {
  const conexion = trx ?? db;
  const [fila] = await conexion('aviso_privacidad_versiones')
    .insert({
      version,
      nombre_archivo: nombreArchivo,
      nombre_original: nombreOriginal,
      subido_por: usuarioId,
    })
    .returning('*');
  return fila;
}

async function listarUltimasVersionesAviso(limite) {
  return db('aviso_privacidad_versiones as v')
    .leftJoin('usuarios as u', 'u.id', 'v.subido_por')
    .orderBy('v.creado_en', 'desc')
    .limit(limite)
    .select(
      'v.id',
      'v.version',
      'v.nombre_archivo',
      'v.nombre_original',
      'v.creado_en',
      db.raw("trim(concat(u.nombre, ' ', u.apellidos)) as subido_por_nombre"),
    );
}

module.exports = {
  obtenerValores,
  guardarValores,
  insertarVersionAviso,
  listarUltimasVersionesAviso,
};
