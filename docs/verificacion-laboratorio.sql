-- Solo lectura. Las fechas corresponden al catálogo local, no al historial de Meta.
BEGIN TRANSACTION READ ONLY;

SELECT id, intencion, slug, activo, aprobado_meta, categoria_meta,
       creado_en, creado_por, actualizado_en, actualizado_por
FROM plantillas_whatsapp
WHERE intencion = 'default_resultados_laboratorio_listos_v2'
   OR slug IN ('resultados-laboratorio-listos-v2', 'resultados_laboratorio_listos_v2')
ORDER BY id;

-- Incluye documentos directos: no limitar por tipo_envio = 'laboratorio'.
SELECT intent_id, conversacion_id, creado_en, actualizado_en,
       payload_funcional::jsonb ->> 'tipo' AS tipo_mensaje,
       payload_funcional::jsonb #>> '{plantilla,name}' AS plantilla_meta,
       payload_funcional::jsonb #>> '{plantilla,language,code}' AS idioma,
       estado, estado_meta, intentos, ultimo_error
FROM outbox_whatsapp
WHERE origen_funcional = 'laboratorio'
  AND creado_en >= NOW() - INTERVAL '2 days'
ORDER BY creado_en DESC, intent_id DESC
LIMIT 100;

SELECT id, enviado_en, plantilla, exitoso, error_codigo, error_mensaje
FROM envios_whatsapp
WHERE origen = 'laboratorio'
  AND enviado_en >= NOW() - INTERVAL '2 days'
ORDER BY enviado_en DESC, id DESC
LIMIT 100;

COMMIT;
