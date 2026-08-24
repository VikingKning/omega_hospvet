CREATE TABLE "usuarios" (
  "id" serial PRIMARY KEY,
  "nombre" varchar(100) NOT NULL,
  "apellidos" varchar(100) NOT NULL,
  "correo" varchar(150) NOT NULL,
  "telefono" varchar(20),
  "username" varchar(50) NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "doctor_id" integer,
  "estatus" varchar(20) NOT NULL DEFAULT 'activo',
  "intentos_fallidos" integer NOT NULL DEFAULT 0,
  "bloqueado_en" timestamptz,
  "ultimo_login_en" timestamptz,
  "creado_por" integer,
  "creado_en" timestamptz NOT NULL,
  "actualizado_por" integer,
  "actualizado_en" timestamptz,
  "desactivado_por" integer,
  "desactivado_en" timestamptz,
  CONSTRAINT "usuarios_estatus_check" CHECK ("estatus" IN ('activo', 'bloqueo_temp', 'bloqueado', 'inactivo', 'cambio_pwd'))
);

CREATE TABLE "permissions" (
  "id" serial PRIMARY KEY,
  "modulo" varchar(50) NOT NULL,
  "accion" varchar(30) NOT NULL,
  "codigo" varchar(100) UNIQUE NOT NULL,
  "descripcion" text
);

CREATE TABLE "usuario_permisos" (
  "id" serial PRIMARY KEY,
  "usuario_id" integer NOT NULL,
  "permission_id" integer NOT NULL,
  "otorgado_por" integer,
  "otorgado_en" timestamptz NOT NULL
);

CREATE TABLE "password_reset_tokens" (
  "id" serial PRIMARY KEY,
  "usuario_id" integer NOT NULL,
  "token_hash" varchar(255) NOT NULL,
  "expira_en" timestamptz NOT NULL,
  "usado_en" timestamptz,
  "solicitado_desde_ip" varchar(45) NOT NULL,
  "creado_en" timestamptz NOT NULL
);

CREATE TABLE "propietarios" (
  "id" serial PRIMARY KEY,
  "nombre" varchar(150) NOT NULL,
  "telefono" varchar(20) UNIQUE NOT NULL,
  "correo" varchar(150),
  "activo" boolean NOT NULL DEFAULT true,
  "creado_por" integer,
  "creado_en" timestamptz NOT NULL,
  "actualizado_por" integer,
  "actualizado_en" timestamptz,
  "desactivado_por" integer,
  "desactivado_en" timestamptz
);

CREATE TABLE "mascotas" (
  "id" serial PRIMARY KEY,
  "propietario_id" integer NOT NULL,
  "nombre" varchar(100) NOT NULL,
  "tipo" varchar(20),
  "raza" varchar(100),
  "activo" boolean NOT NULL DEFAULT true,
  "creado_por" integer,
  "creado_en" timestamptz NOT NULL,
  "actualizado_por" integer,
  "actualizado_en" timestamptz,
  "desactivado_por" integer,
  "desactivado_en" timestamptz
);

CREATE TABLE "doctores" (
  "id" serial PRIMARY KEY,
  "nombre" varchar(100) NOT NULL,
  "apellidos" varchar(100) NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "creado_por" integer,
  "creado_en" timestamptz NOT NULL,
  "actualizado_por" integer,
  "actualizado_en" timestamptz,
  "desactivado_por" integer,
  "desactivado_en" timestamptz
);

CREATE TABLE "areas" (
  "id" serial PRIMARY KEY,
  "nombre" varchar(100) UNIQUE NOT NULL,
  "slug" varchar(100) UNIQUE NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "color_google_calendar" varchar(2),
  "creado_por" integer,
  "creado_en" timestamptz NOT NULL,
  "actualizado_por" integer,
  "actualizado_en" timestamptz,
  "desactivado_por" integer,
  "desactivado_en" timestamptz
);

CREATE TABLE "doctor_area" (
  "id" serial PRIMARY KEY,
  "doctor_id" integer NOT NULL,
  "area_id" integer NOT NULL
);

CREATE TABLE "citas" (
  "id" serial PRIMARY KEY,
  "area_id" integer NOT NULL,
  "doctor_id" integer NOT NULL,
  "mascota_id" integer NOT NULL,
  "fecha_hora_inicio" timestamptz NOT NULL,
  "duracion_minutos" integer NOT NULL,
  "motivo" text,
  "estado" varchar(20) NOT NULL,
  "origen" varchar(20) NOT NULL,
  "google_event_id" varchar(255),
  "google_sincronizado_en" timestamptz,
  "mensaje_confirmacion_enviado_en" timestamptz,
  "creado_por" integer,
  "creado_en" timestamptz NOT NULL,
  "confirmada_por" integer,
  "confirmada_en" timestamptz,
  "cancelado_por" integer,
  "cancelado_en" timestamptz,
  "actualizado_por" integer,
  "actualizado_en" timestamptz
);

CREATE TABLE "registros_laboratorio" (
  "id" serial PRIMARY KEY,
  "mascota_id" integer NOT NULL,
  "doctor_id" integer,
  "fecha_solicitud" date NOT NULL,
  "estado" varchar(20) NOT NULL,
  "pendiente_desde" timestamptz NOT NULL,
  "cargado_en" timestamptz,
  "enviado_en" timestamptz,
  "eliminado" boolean NOT NULL DEFAULT false,
  "eliminado_por" integer,
  "eliminado_en" timestamptz,
  "creado_por" integer NOT NULL,
  "creado_en" timestamptz NOT NULL,
  "actualizado_por" integer,
  "actualizado_en" timestamptz
);

CREATE TABLE "estudios_solicitados" (
  "id" serial PRIMARY KEY,
  "registro_laboratorio_id" integer NOT NULL,
  "estudio_id" integer NOT NULL,
  "zona_anatomica_id" integer,
  "archivo_id" integer,
  "estado" varchar(20) NOT NULL,
  "creado_en" timestamptz NOT NULL
);

CREATE TABLE "catalogo_categorias_estudio" (
  "id" serial PRIMARY KEY,
  "nombre" varchar(100) UNIQUE NOT NULL,
  "activo" boolean NOT NULL DEFAULT true
);

CREATE TABLE "catalogo_estudios" (
  "id" serial PRIMARY KEY,
  "categoria_id" integer NOT NULL,
  "codigo" varchar(50) UNIQUE NOT NULL,
  "nombre" varchar(200) NOT NULL,
  "requiere_zona" boolean NOT NULL DEFAULT false,
  "activo" boolean NOT NULL DEFAULT true
);

CREATE TABLE "catalogo_zonas_anatomicas" (
  "id" serial PRIMARY KEY,
  "codigo" varchar(50) UNIQUE NOT NULL,
  "nombre" varchar(100) NOT NULL
);

CREATE TABLE "archivos_laboratorio" (
  "id" serial PRIMARY KEY,
  "registro_laboratorio_id" integer NOT NULL,
  "nombre_original" varchar(255) NOT NULL,
  "ruta_almacenamiento" varchar(500) NOT NULL,
  "hash_contenido" varchar(64) NOT NULL,
  "tamano_bytes" integer NOT NULL,
  "consolidado" boolean NOT NULL DEFAULT false,
  "cargado_por" integer NOT NULL,
  "cargado_en" timestamptz NOT NULL
);

CREATE TABLE "envios_laboratorio" (
  "id" serial PRIMARY KEY,
  "registro_laboratorio_id" integer NOT NULL,
  "medio" varchar(20) NOT NULL,
  "destinatario_correo" varchar(150),
  "destinatario_telefono" varchar(20),
  "enviado_por" integer NOT NULL,
  "enviado_en" timestamptz NOT NULL
);

CREATE TABLE "envio_archivo" (
  "id" serial PRIMARY KEY,
  "envio_id" integer NOT NULL,
  "archivo_id" integer NOT NULL
);

CREATE TABLE "plantillas_whatsapp" (
  "id" serial PRIMARY KEY,
  "intencion" varchar(100) UNIQUE NOT NULL,
  "slug" varchar(100) UNIQUE NOT NULL,
  "texto_respuesta" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "veces_usada" integer NOT NULL DEFAULT 0,
  "creado_por" integer,
  "creado_en" timestamptz NOT NULL,
  "actualizado_por" integer,
  "actualizado_en" timestamptz,
  "desactivado_por" integer,
  "desactivado_en" timestamptz
);

CREATE TABLE "mensajes_whatsapp" (
  "id" serial PRIMARY KEY,
  "telefono_origen" varchar(20) NOT NULL,
  "mensaje_recibido" text NOT NULL,
  "categoria_clasificacion" varchar(30) NOT NULL,
  "plantilla_id" integer,
  "tokens_entrada" integer NOT NULL,
  "tokens_salida" integer NOT NULL,
  "cita_generada_id" integer,
  "registro_laboratorio_id" integer,
  "recibido_en" timestamptz NOT NULL,
  "procesado_en" timestamptz
);

CREATE UNIQUE INDEX ON "usuarios" ("correo");

CREATE UNIQUE INDEX ON "usuarios" ("username");

CREATE INDEX ON "usuarios" ("estatus");

CREATE UNIQUE INDEX ON "usuario_permisos" ("usuario_id", "permission_id");

CREATE UNIQUE INDEX ON "doctor_area" ("doctor_id", "area_id");

CREATE INDEX ON "archivos_laboratorio" ("hash_contenido");

COMMENT ON TABLE "usuarios" IS 'Cuentas de acceso al panel. doctor_id es opcional y en un solo sentido (2.6.3).';

COMMENT ON TABLE "permissions" IS 'Catálogo fijo de permisos posibles, consumido por requirePermission().';

COMMENT ON TABLE "usuario_permisos" IS 'Matriz de permisos por usuario, sin rol intermedio (2.6.2). Se cachea en sesión al hacer login.';

COMMENT ON TABLE "password_reset_tokens" IS 'Recuperación de contraseña de un solo uso, expira a los 30 minutos (2.1.2).';

COMMENT ON TABLE "propietarios" IS 'UI: "Tutor". El teléfono es el identificador de búsqueda al dar de alta cita/laboratorio y el canal de WhatsApp.';

COMMENT ON TABLE "mascotas" IS 'UI: "Paciente". Un propietario puede tener una o más mascotas (1 a muchos).';

COMMENT ON TABLE "doctores" IS 'Catálogo independiente de usuarios; un doctor puede existir sin cuenta de acceso.';

COMMENT ON TABLE "areas" IS 'Cada área activa genera automáticamente su propia vista de agenda (2.3).';

COMMENT ON TABLE "doctor_area" IS 'Muchos a muchos: un doctor puede atender varias áreas (2.6.3).';

COMMENT ON TABLE "citas" IS 'Fuente de verdad de la agenda; Google Calendar es solo espejo (Decisión 7). El tutor se obtiene vía mascotas.propietario_id.';

COMMENT ON COLUMN "citas"."estado" IS 'registrada | confirmada | cancelada';

COMMENT ON COLUMN "citas"."origen" IS 'portal | whatsapp';

COMMENT ON TABLE "registros_laboratorio" IS 'Registro único de laboratorio (sin QVET). El tutor se obtiene vía mascotas.propietario_id.';

COMMENT ON COLUMN "registros_laboratorio"."estado" IS 'pendiente | cargado | enviado';

COMMENT ON TABLE "estudios_solicitados" IS 'Detalle de estudios (2.4.1). archivo_id permite que varios estudios compartan un mismo archivo consolidado.';

COMMENT ON COLUMN "estudios_solicitados"."estado" IS 'pendiente | enviado';

COMMENT ON COLUMN "archivos_laboratorio"."hash_contenido" IS 'SHA-256, indexado para validación global de duplicados';

COMMENT ON COLUMN "archivos_laboratorio"."consolidado" IS 'true = PDF generado por el sistema fusionando varios archivos del mismo registro';

COMMENT ON TABLE "envios_laboratorio" IS 'destinatario_correo/telefono son una fotografía del dato de contacto al momento del envío (no cambian si el tutor corrige sus datos después).';

COMMENT ON COLUMN "envios_laboratorio"."medio" IS 'correo | whatsapp | ambos';

COMMENT ON TABLE "envio_archivo" IS 'Puente envío↔archivo; permite reenviar el mismo archivo en envíos posteriores.';

COMMENT ON TABLE "plantillas_whatsapp" IS 'Respuestas fijas y pre-aprobadas; el LLM nunca genera este texto libremente.';

COMMENT ON TABLE "mensajes_whatsapp" IS 'Fuente de las métricas del bloque WhatsApp (2.5.1). telefono_origen puede correlacionar con propietarios.telefono si hay coincidencia.';

COMMENT ON COLUMN "mensajes_whatsapp"."categoria_clasificacion" IS 'emergencia | duda_medica | agendar_cita | resultados_laboratorio';

ALTER TABLE "usuarios" ADD FOREIGN KEY ("doctor_id") REFERENCES "doctores" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "usuarios" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "usuarios" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "usuarios" ADD FOREIGN KEY ("desactivado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "usuario_permisos" ADD FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "usuario_permisos" ADD FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "usuario_permisos" ADD FOREIGN KEY ("otorgado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "password_reset_tokens" ADD FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "propietarios" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "propietarios" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "propietarios" ADD FOREIGN KEY ("desactivado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "mascotas" ADD FOREIGN KEY ("propietario_id") REFERENCES "propietarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "mascotas" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "mascotas" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "mascotas" ADD FOREIGN KEY ("desactivado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "doctores" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "doctores" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "doctores" ADD FOREIGN KEY ("desactivado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "areas" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "areas" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "areas" ADD FOREIGN KEY ("desactivado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "doctor_area" ADD FOREIGN KEY ("doctor_id") REFERENCES "doctores" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "doctor_area" ADD FOREIGN KEY ("area_id") REFERENCES "areas" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "citas" ADD FOREIGN KEY ("area_id") REFERENCES "areas" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "citas" ADD FOREIGN KEY ("doctor_id") REFERENCES "doctores" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "citas" ADD FOREIGN KEY ("mascota_id") REFERENCES "mascotas" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "citas" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "citas" ADD FOREIGN KEY ("confirmada_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "citas" ADD FOREIGN KEY ("cancelado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "citas" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "registros_laboratorio" ADD FOREIGN KEY ("mascota_id") REFERENCES "mascotas" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "registros_laboratorio" ADD FOREIGN KEY ("doctor_id") REFERENCES "doctores" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "registros_laboratorio" ADD FOREIGN KEY ("eliminado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "registros_laboratorio" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "registros_laboratorio" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estudios_solicitados" ADD FOREIGN KEY ("registro_laboratorio_id") REFERENCES "registros_laboratorio" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estudios_solicitados" ADD FOREIGN KEY ("estudio_id") REFERENCES "catalogo_estudios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estudios_solicitados" ADD FOREIGN KEY ("zona_anatomica_id") REFERENCES "catalogo_zonas_anatomicas" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estudios_solicitados" ADD FOREIGN KEY ("archivo_id") REFERENCES "archivos_laboratorio" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalogo_estudios" ADD FOREIGN KEY ("categoria_id") REFERENCES "catalogo_categorias_estudio" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "archivos_laboratorio" ADD FOREIGN KEY ("registro_laboratorio_id") REFERENCES "registros_laboratorio" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "archivos_laboratorio" ADD FOREIGN KEY ("cargado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "envios_laboratorio" ADD FOREIGN KEY ("registro_laboratorio_id") REFERENCES "registros_laboratorio" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "envios_laboratorio" ADD FOREIGN KEY ("enviado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "envio_archivo" ADD FOREIGN KEY ("envio_id") REFERENCES "envios_laboratorio" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "envio_archivo" ADD FOREIGN KEY ("archivo_id") REFERENCES "archivos_laboratorio" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "plantillas_whatsapp" ADD FOREIGN KEY ("creado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "plantillas_whatsapp" ADD FOREIGN KEY ("actualizado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "plantillas_whatsapp" ADD FOREIGN KEY ("desactivado_por") REFERENCES "usuarios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "mensajes_whatsapp" ADD FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_whatsapp" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "mensajes_whatsapp" ADD FOREIGN KEY ("cita_generada_id") REFERENCES "citas" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "mensajes_whatsapp" ADD FOREIGN KEY ("registro_laboratorio_id") REFERENCES "registros_laboratorio" ("id") DEFERRABLE INITIALLY IMMEDIATE;
