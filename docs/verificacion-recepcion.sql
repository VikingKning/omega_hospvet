-- Solo lectura; no incluye textos del cliente ni teléfonos.
BEGIN TRANSACTION READ ONLY;

SELECT id, estado, menu_principal_vigente_en, recepcion_prioritaria_en,
       atencion_humana_desde, atencion_humana_hasta, cerrado_en
FROM conversaciones_whatsapp
WHERE recepcion_prioritaria_en >= NOW() - INTERVAL '2 days'
ORDER BY recepcion_prioritaria_en DESC
LIMIT 30;

SELECT g.group_id, g.conversacion_id, g.estado, g.resultado_decision,
       g.clasificado_en, g.procesado_en, g.intento_envio_id,
       g.llamadas_claude, g.tokens_entrada, g.tokens_salida
FROM grupos_whatsapp AS g
JOIN conversaciones_whatsapp AS c ON c.id = g.conversacion_id
WHERE c.recepcion_prioritaria_en >= NOW() - INTERVAL '2 days'
ORDER BY g.conversacion_id DESC, g.group_id
LIMIT 100;

SELECT o.intent_id, o.conversacion_id, o.origen_funcional, o.estado,
       o.estado_meta, o.intentos, o.ultimo_error, o.creado_en, o.actualizado_en
FROM outbox_whatsapp AS o
JOIN conversaciones_whatsapp AS c ON c.id = o.conversacion_id
WHERE c.recepcion_prioritaria_en >= NOW() - INTERVAL '2 days'
ORDER BY o.conversacion_id DESC, o.intent_id
LIMIT 100;

SELECT s.id, s.conversacion_id, s.estado, s.solicitado_en,
       s.enviado_en, s.finalizado_en, s.reintentar_despues_de, s.outbox_id
FROM solicitudes_atencion_humana AS s
JOIN conversaciones_whatsapp AS c ON c.id = s.conversacion_id
WHERE c.recepcion_prioritaria_en >= NOW() - INTERVAL '2 days'
  AND s.origen = 'recepcion'
ORDER BY s.solicitado_en DESC, s.id DESC
LIMIT 100;

COMMIT;
