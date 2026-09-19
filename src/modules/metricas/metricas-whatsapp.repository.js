const db = require('../../config/database');
const env = require('../../config/env');

const ZONA_HORARIA = /^[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)*$/.test(env.operationalTimezone)
  ? env.operationalTimezone
  : 'America/Mexico_City';
const ENVIO_LOCAL = `timezone('${ZONA_HORARIA}', ew.enviado_en)`;
const TIPOS_SOPORTADOS = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'interactive_list_reply',
  'interactive_button_reply',
];
const AGRUPACIONES = {
  dia: `date_trunc('day', ${ENVIO_LOCAL})`,
  semana: `date_trunc('week', ${ENVIO_LOCAL})`,
  mes: `date_trunc('month', ${ENVIO_LOCAL})`,
};

function baseQuery({ desde, hasta }) {
  return db('envios_whatsapp as ew')
    .whereRaw(`${ENVIO_LOCAL}::date >= ?`, [desde])
    .andWhereRaw(`${ENVIO_LOCAL}::date <= ?`, [hasta]);
}

async function obtenerResumen(rango) {
  return baseQuery(rango)
    .first()
    .count({ total: 'ew.id' })
    .select(
      db.raw('count(*) filter (where ew.exitoso is true) as exitosos'),
      db.raw('count(*) filter (where ew.exitoso is false) as fallidos'),
    );
}

async function contarPorPeriodo(rango, agrupacion) {
  const periodo = AGRUPACIONES[agrupacion] ?? AGRUPACIONES.dia;
  return baseQuery(rango)
    .groupByRaw(periodo)
    .orderByRaw(periodo)
    .select(db.raw(`${periodo}::date as periodo`))
    .count({ total: 'ew.id' })
    .select(db.raw('count(*) filter (where ew.exitoso is true) as exitosos'));
}

async function contarPorPlantilla(rango) {
  return baseQuery(rango)
    .groupBy('ew.plantilla')
    .select('ew.plantilla')
    .count({ total: 'ew.id' })
    .orderBy('total', 'desc');
}

async function listarErrores(rango) {
  return baseQuery(rango)
    .where('ew.exitoso', false)
    .groupBy('ew.error_codigo', 'ew.error_mensaje')
    .select('ew.error_codigo', 'ew.error_mensaje')
    .count({ total: 'ew.id' });
}

async function contarPorDiaHora(rango) {
  return baseQuery(rango)
    .groupByRaw(`extract(isodow from ${ENVIO_LOCAL})`)
    .groupByRaw(`extract(hour from ${ENVIO_LOCAL})`)
    .select(
      db.raw(`extract(isodow from ${ENVIO_LOCAL})::int as dia_semana`),
      db.raw(`extract(hour from ${ENVIO_LOCAL})::int as hora`),
    )
    .count({ total: 'ew.id' })
    .select(db.raw('count(*) filter (where ew.exitoso is false) as fallidos'));
}

async function topPlantillasConFallos(rango) {
  return baseQuery(rango)
    .groupBy('ew.plantilla')
    .select('ew.plantilla')
    .select(db.raw('count(*) filter (where ew.exitoso is false) as total'))
    .orderBy('total', 'desc')
    .limit(10);
}

function fechaLocal(columna) {
  return `timezone('${ZONA_HORARIA}', ${columna})`;
}

function enRango(columna) {
  return `${fechaLocal(columna)}::date between ?::date and ?::date`;
}

async function obtenerResumenConversacional({ desde, hasta }) {
  const soportados = TIPOS_SOPORTADOS.map(() => '?').join(', ');
  const bindings = [
    ...TIPOS_SOPORTADOS,
    desde,
    hasta,
    desde,
    hasta,
    desde,
    hasta,
    desde,
    hasta,
    desde,
    hasta,
    desde,
    hasta,
  ];
  const { rows } = await db.raw(
    `
      WITH mensajes AS (
        SELECT * FROM mensajes_whatsapp m
         WHERE m.direccion = 'entrante'
           AND m.whatsapp_message_id IS NOT NULL
           AND m.tipo_mensaje IN (${soportados})
           AND ${enRango('m.recibido_en')}
      ), grupos AS (
        SELECT * FROM grupos_whatsapp g
         WHERE g.enrutado_en IS NOT NULL AND ${enRango('g.enrutado_en')}
      ), transferencias AS (
        SELECT s.origen FROM solicitudes_atencion_humana s
         WHERE ${enRango('s.solicitado_en')}
        UNION ALL
        SELECT 'inicio_manual_omega' origen FROM conversaciones_whatsapp c
         WHERE c.origen_atencion_humana = 'iniciada_por_omega'
           AND c.atencion_humana_desde IS NOT NULL
           AND ${enRango('c.atencion_humana_desde')}
      ), emergencias AS (
        SELECT * FROM grupos_whatsapp g
         WHERE g.enrutado_en IS NOT NULL
           AND g.es_emergencia_resuelta IS TRUE
           AND ${enRango('g.enrutado_en')}
      ), llamadas_legacy AS (
        SELECT count(*)::int total FROM eventos_metricas_whatsapp e
         WHERE e.tipo_evento = 'llamada_claude' AND ${enRango('e.ocurrido_en')}
      )
      SELECT
        (SELECT count(*) FROM mensajes) AS mensajes_entrantes,
        (SELECT count(*) FROM mensajes WHERE group_id IS NOT NULL) AS fragmentos_procesables,
        (SELECT count(*) FROM grupos) AS grupos_procesados,
        (SELECT count(*) FROM grupos WHERE llamadas_claude = 0) AS grupos_sin_claude,
        (SELECT coalesce(sum(llamadas_claude), 0) FROM grupos) +
          (SELECT total FROM llamadas_legacy) AS llamadas_claude,
        (SELECT count(*) FROM transferencias) AS transferencias_humanas,
        (SELECT count(*) FROM emergencias) AS emergencias_confirmadas,
        (SELECT count(*) FROM mensajes WHERE pipeline_asignado = 'conversacional_nuevo') AS pipeline_nuevo,
        (SELECT count(*) FROM mensajes WHERE pipeline_asignado = 'flujo_anterior') AS pipeline_anterior
    `,
    bindings,
  );
  return rows[0];
}

async function contarTendenciaConversacional({ desde, hasta }) {
  const soportados = TIPOS_SOPORTADOS.map(() => '?').join(', ');
  const { rows } = await db.raw(
    `
      WITH mensajes AS (
        SELECT ${fechaLocal('m.recibido_en')}::date periodo, count(*)::int total
          FROM mensajes_whatsapp m
         WHERE m.direccion = 'entrante' AND m.whatsapp_message_id IS NOT NULL
           AND m.tipo_mensaje IN (${soportados}) AND ${enRango('m.recibido_en')}
         GROUP BY 1
      ), grupos AS (
        SELECT ${fechaLocal('g.enrutado_en')}::date periodo, count(*)::int total
          FROM grupos_whatsapp g
         WHERE g.enrutado_en IS NOT NULL AND ${enRango('g.enrutado_en')}
         GROUP BY 1
      ), respuestas AS (
        SELECT ${fechaLocal('o.actualizado_en')}::date periodo, count(*)::int total
          FROM outbox_whatsapp o
         WHERE o.origen_funcional = 'respuesta_automatica' AND o.estado = 'enviado'
           AND o.wamid IS NOT NULL AND ${enRango('o.actualizado_en')}
         GROUP BY 1
      )
      SELECT coalesce(m.periodo, g.periodo, r.periodo) periodo,
             coalesce(m.total, 0) mensajes,
             coalesce(g.total, 0) grupos,
             coalesce(r.total, 0) respuestas
        FROM mensajes m FULL JOIN grupos g USING (periodo)
        FULL JOIN respuestas r ON r.periodo = coalesce(m.periodo, g.periodo)
       ORDER BY 1
    `,
    [...TIPOS_SOPORTADOS, desde, hasta, desde, hasta, desde, hasta],
  );
  return rows;
}

async function obtenerAgrupacionConversacional({ desde, hasta }) {
  const [resumen, distribucion] = await Promise.all([
    db.raw(
      `SELECT count(DISTINCT g.group_id)::int grupos,
              count(m.id)::int fragmentos
         FROM grupos_whatsapp g
         LEFT JOIN mensajes_whatsapp m ON m.group_id = g.group_id
        WHERE g.enrutado_en IS NOT NULL AND ${enRango('g.enrutado_en')}`,
      [desde, hasta],
    ),
    db.raw(
      `SELECT cantidad_fragmentos, count(*)::int total
         FROM (
           SELECT g.group_id, count(m.id)::int cantidad_fragmentos
             FROM grupos_whatsapp g
             LEFT JOIN mensajes_whatsapp m ON m.group_id = g.group_id
            WHERE g.enrutado_en IS NOT NULL AND ${enRango('g.enrutado_en')}
            GROUP BY g.group_id
         ) x
        GROUP BY cantidad_fragmentos ORDER BY cantidad_fragmentos`,
      [desde, hasta],
    ),
  ]);
  return { resumen: resumen.rows[0], distribucion: distribucion.rows };
}

async function contarRutasConversacionales({ desde, hasta }) {
  const { rows } = await db.raw(
    `SELECT ruta, count(*)::int total FROM (
       SELECT CASE
                WHEN g.ruta_enrutamiento = 'consulta_libre' AND g.llamadas_claude = 0
                  THEN 'consulta_libre_sin_claude'
                WHEN g.ruta_enrutamiento = 'consulta_libre' AND g.llamadas_claude > 0
                  THEN 'consulta_libre_claude'
                ELSE g.ruta_enrutamiento
              END ruta
         FROM grupos_whatsapp g
        WHERE g.enrutado_en IS NOT NULL AND ${enRango('g.enrutado_en')}
       UNION ALL
       SELECT m.ruta_enrutamiento ruta
         FROM mensajes_whatsapp m
        WHERE m.decision_en IS NOT NULL AND m.group_id IS NULL
          AND ${enRango('m.decision_en')}
       UNION ALL
       SELECT 'atencion_humana' ruta
         FROM solicitudes_atencion_humana s
        WHERE ${enRango('s.solicitado_en')}
       UNION ALL
       SELECT 'atencion_humana' ruta
         FROM conversaciones_whatsapp c
        WHERE c.origen_atencion_humana = 'iniciada_por_omega'
          AND c.atencion_humana_desde IS NOT NULL
          AND ${enRango('c.atencion_humana_desde')}
     ) decisiones
     WHERE ruta IS NOT NULL GROUP BY ruta ORDER BY total DESC, ruta`,
    [desde, hasta, desde, hasta, desde, hasta, desde, hasta],
  );
  return rows;
}

async function contarSeleccionesMenu({ desde, hasta }) {
  const { rows } = await db.raw(
    `SELECT m.mensaje_recibido identificador, count(*)::int total
       FROM mensajes_whatsapp m
      WHERE m.tipo_mensaje IN ('interactive_list_reply', 'interactive_button_reply')
        AND m.estado_procesamiento = 'procesado'
        AND m.mensaje_recibido IS NOT NULL
        AND ${enRango('m.recibido_en')}
      GROUP BY m.mensaje_recibido ORDER BY total DESC, identificador`,
    [desde, hasta],
  );
  return rows;
}

async function obtenerUsoClaude({ desde, hasta }) {
  const [resumen, categorias, resultados] = await Promise.all([
    db.raw(
      `WITH grupos AS (
         SELECT * FROM grupos_whatsapp g
          WHERE g.enrutado_en IS NOT NULL AND ${enRango('g.enrutado_en')}
       ), legacy AS (
         SELECT coalesce(sum(m.tokens_entrada), 0)::int tokens_entrada,
                coalesce(sum(m.tokens_salida), 0)::int tokens_salida
           FROM mensajes_whatsapp m
          WHERE m.pipeline_asignado = 'flujo_anterior' AND m.decision_en IS NOT NULL
            AND ${enRango('m.decision_en')}
       ), llamadas_legacy AS (
         SELECT count(*)::int total FROM eventos_metricas_whatsapp e
          WHERE e.tipo_evento = 'llamada_claude' AND ${enRango('e.ocurrido_en')}
       )
       SELECT (coalesce(sum(g.llamadas_claude), 0) + (SELECT total FROM llamadas_legacy))::int llamadas,
              (coalesce(sum(g.tokens_entrada), 0) + (SELECT tokens_entrada FROM legacy))::int tokens_entrada,
              (coalesce(sum(g.tokens_salida), 0) + (SELECT tokens_salida FROM legacy))::int tokens_salida,
              count(*) FILTER (WHERE g.llamadas_claude = 0)::int grupos_cero,
              count(*) FILTER (WHERE g.llamadas_claude = 1)::int grupos_una,
              count(*) FILTER (WHERE g.llamadas_claude >= 2)::int grupos_dos_o_mas,
              (count(*) FILTER (WHERE g.llamadas_claude > 0) +
                (SELECT count(DISTINCT e.mensaje_id) FROM eventos_metricas_whatsapp e
                  WHERE e.tipo_evento = 'llamada_claude' AND ${enRango('e.ocurrido_en')}))::int unidades_con_claude
         FROM grupos g`,
      [desde, hasta, desde, hasta, desde, hasta, desde, hasta],
    ),
    db.raw(
      `SELECT coalesce(g.categoria_resuelta, 'sin_categoria') categoria, count(*)::int total
         FROM grupos_whatsapp g
        WHERE g.enrutado_en IS NOT NULL AND g.llamadas_claude > 0
          AND ${enRango('g.enrutado_en')}
        GROUP BY 1 ORDER BY total DESC`,
      [desde, hasta],
    ),
    db.raw(
      `SELECT e.resultado, count(*)::int total
         FROM eventos_metricas_whatsapp e
        WHERE e.tipo_evento IN ('claude_resultado', 'llamada_claude')
          AND ${enRango('e.ocurrido_en')}
        GROUP BY e.resultado ORDER BY total DESC`,
      [desde, hasta],
    ),
  ]);
  return { resumen: resumen.rows[0], categorias: categorias.rows, resultados: resultados.rows };
}

async function obtenerDescartesYReintentos({ desde, hasta }) {
  const soportados = TIPOS_SOPORTADOS.map(() => '?').join(', ');
  const { rows } = await db.raw(
    `SELECT
       (SELECT count(*) FROM mensajes_whatsapp m
         WHERE (m.tipo_mensaje IS NULL OR m.tipo_mensaje NOT IN (${soportados}))
           AND m.direccion = 'entrante'
           AND ${enRango('m.recibido_en')})::int mensajes_no_soportados,
       (SELECT count(*) FROM eventos_metricas_whatsapp e
         WHERE e.tipo_evento = 'estado_meta' AND ${enRango('e.ocurrido_en')})::int eventos_estado,
       (SELECT coalesce(sum(m.reentregas_meta), 0) FROM mensajes_whatsapp m
         WHERE m.direccion = 'entrante' AND ${enRango('m.recibido_en')})::int duplicados_meta,
       (SELECT coalesce(sum(greatest(g.intentos_enrutamiento - 1, 0)), 0)
          FROM grupos_whatsapp g WHERE g.enrutado_en IS NOT NULL
           AND ${enRango('g.enrutado_en')})::int reintentos_router,
       (SELECT coalesce(sum(greatest(o.intentos - 1, 0)), 0)
          FROM outbox_whatsapp o WHERE o.tipo_envio = 'conversacional'
           AND ${enRango('o.creado_en')})::int reintentos_envio`,
    [...TIPOS_SOPORTADOS, desde, hasta, desde, hasta, desde, hasta, desde, hasta, desde, hasta],
  );
  return rows[0];
}

async function obtenerTiemposProcesamiento({ desde, hasta }) {
  const { rows } = await db.raw(
    `WITH ultimo_fragmento AS (
       SELECT group_id, max(recibido_en) ultimo_en
         FROM mensajes_whatsapp WHERE group_id IS NOT NULL GROUP BY group_id
     )
     SELECT
       coalesce(avg(extract(epoch FROM (g.enrutado_en - u.ultimo_en)))
         FILTER (WHERE g.enrutado_en >= u.ultimo_en), 0)::numeric(12,2) segundos_fragmento_decision,
       coalesce(avg(extract(epoch FROM (o.actualizado_en - g.enrutado_en)))
         FILTER (WHERE o.actualizado_en >= g.enrutado_en
           AND o.estado IN ('enviado', 'fallido', 'ventana_servicio_expirada')), 0)::numeric(12,2)
         segundos_decision_envio
      FROM grupos_whatsapp g
      LEFT JOIN ultimo_fragmento u ON u.group_id = g.group_id
      LEFT JOIN outbox_whatsapp o ON o.intent_id = g.intento_envio_id
     WHERE g.enrutado_en IS NOT NULL AND ${enRango('g.enrutado_en')}`,
    [desde, hasta],
  );
  return rows[0];
}

async function obtenerAtencionYAlertas({ desde, hasta }) {
  const [transferencias, alertas, canales, destinatarios] = await Promise.all([
    db.raw(
      `SELECT origen, count(*)::int total FROM (
         SELECT s.origen FROM solicitudes_atencion_humana s
          WHERE ${enRango('s.solicitado_en')}
         UNION ALL
         SELECT 'inicio_manual_omega' origen FROM conversaciones_whatsapp c
          WHERE c.origen_atencion_humana = 'iniciada_por_omega'
            AND c.atencion_humana_desde IS NOT NULL
            AND ${enRango('c.atencion_humana_desde')}
       ) x GROUP BY origen ORDER BY total DESC`,
      [desde, hasta, desde, hasta],
    ),
    db.raw(
      `SELECT a.tipo_alerta, a.estado, count(*)::int total,
              coalesce(avg(extract(epoch FROM (a.atendida_en - a.creado_en)))
                FILTER (WHERE a.atendida_en IS NOT NULL), 0)::numeric(12,2) segundos_atencion
         FROM alertas_atencion_whatsapp a
        WHERE ${enRango('a.creado_en')}
        GROUP BY a.tipo_alerta, a.estado ORDER BY a.tipo_alerta, a.estado`,
      [desde, hasta],
    ),
    db.raw(
      `SELECT i.canal, i.estado, count(*)::int total
         FROM intentos_alerta_whatsapp i
        JOIN alertas_atencion_whatsapp a ON a.id = i.alerta_id
        WHERE ${enRango('a.creado_en')}
        GROUP BY i.canal, i.estado ORDER BY i.canal, i.estado`,
      [desde, hasta],
    ),
    db.raw(
      `SELECT count(DISTINCT d.id)::int destinatarios_seleccionados,
              count(DISTINCT (a.id, i.destino_normalizado))
                FILTER (WHERE i.canal = 'whatsapp' AND i.estado = 'enviado')::int envios_whatsapp_unicos
         FROM alertas_atencion_whatsapp a
         LEFT JOIN destinatarios_alerta_whatsapp d ON d.alerta_id = a.id
         LEFT JOIN intentos_alerta_whatsapp i ON i.alerta_id = a.id
           AND i.destinatario_id = d.id
        WHERE ${enRango('a.creado_en')}`,
      [desde, hasta],
    ),
  ]);
  return {
    transferencias: transferencias.rows,
    alertas: alertas.rows,
    canales: canales.rows,
    destinatarios: destinatarios.rows[0],
  };
}

async function contarMapaCalorConversacional({ desde, hasta }) {
  const soportados = TIPOS_SOPORTADOS.map(() => '?').join(', ');
  const { rows } = await db.raw(
    `WITH total AS (
       SELECT extract(isodow FROM ${fechaLocal('m.recibido_en')})::int dia_semana,
              extract(hour FROM ${fechaLocal('m.recibido_en')})::int hora,
              count(*)::int total
         FROM mensajes_whatsapp m
        WHERE m.direccion = 'entrante' AND m.whatsapp_message_id IS NOT NULL
          AND m.tipo_mensaje IN (${soportados})
          AND ${enRango('m.recibido_en')}
        GROUP BY 1, 2
     ), emergencia AS (
       SELECT extract(isodow FROM ${fechaLocal('g.enrutado_en')})::int dia_semana,
              extract(hour FROM ${fechaLocal('g.enrutado_en')})::int hora,
              count(*)::int total
         FROM grupos_whatsapp g
        WHERE g.es_emergencia_resuelta IS TRUE AND g.enrutado_en IS NOT NULL
          AND ${enRango('g.enrutado_en')}
        GROUP BY 1, 2
     ), recepcion AS (
       SELECT extract(isodow FROM ${fechaLocal('s.solicitado_en')})::int dia_semana,
              extract(hour FROM ${fechaLocal('s.solicitado_en')})::int hora,
              count(*)::int total
         FROM solicitudes_atencion_humana s
        WHERE s.origen = 'recepcion' AND ${enRango('s.solicitado_en')}
        GROUP BY 1, 2
     )
     SELECT coalesce(t.dia_semana, e.dia_semana, r.dia_semana) dia_semana,
            coalesce(t.hora, e.hora, r.hora) hora,
            coalesce(t.total, 0) total,
            coalesce(e.total, 0) emergencias,
            coalesce(r.total, 0) recepcion
       FROM total t FULL JOIN emergencia e USING (dia_semana, hora)
       FULL JOIN recepcion r ON r.dia_semana = coalesce(t.dia_semana, e.dia_semana)
        AND r.hora = coalesce(t.hora, e.hora)
      ORDER BY 1, 2`,
    [...TIPOS_SOPORTADOS, desde, hasta, desde, hasta, desde, hasta],
  );
  return rows;
}

module.exports = {
  obtenerResumen,
  contarPorPeriodo,
  contarPorPlantilla,
  listarErrores,
  contarPorDiaHora,
  topPlantillasConFallos,
  obtenerResumenConversacional,
  contarTendenciaConversacional,
  obtenerAgrupacionConversacional,
  contarRutasConversacionales,
  contarSeleccionesMenu,
  obtenerUsoClaude,
  obtenerDescartesYReintentos,
  obtenerTiemposProcesamiento,
  obtenerAtencionYAlertas,
  contarMapaCalorConversacional,
  ZONA_HORARIA,
};
