// Única capa que habla con Knex para este módulo (documento de
// Arquitectura y Buenas Prácticas, sección 4.1) — bitácora de mensajes
// entrantes ya clasificados. `mensajes_whatsapp` existía en el schema
// desde el día 1 (junto con `plantilla_id`/`cita_generada_id`/
// `registro_laboratorio_id`/`tokens_entrada`/`tokens_salida`) sin ningún
// flujo real que la usara hasta este módulo.
const db = require('../../config/database');

async function crearMensaje({
  telefonoOrigen,
  mensajeRecibido,
  categoriaClasificacion,
  plantillaId,
  citaGeneradaId,
  registroLaboratorioId,
  tokensEntrada,
  tokensSalida,
  recibidoEn,
}) {
  const [row] = await db('mensajes_whatsapp')
    .insert({
      telefono_origen: telefonoOrigen,
      mensaje_recibido: mensajeRecibido,
      categoria_clasificacion: categoriaClasificacion,
      plantilla_id: plantillaId ?? null,
      cita_generada_id: citaGeneradaId ?? null,
      registro_laboratorio_id: registroLaboratorioId ?? null,
      tokens_entrada: tokensEntrada,
      tokens_salida: tokensSalida,
      recibido_en: recibidoEn,
      procesado_en: db.fn.now(),
    })
    .returning('id');
  return row.id;
}

module.exports = { crearMensaje };
