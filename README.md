<p align="center">
  <img src="public/assets/imgs/icon.png" alt="Omega Veterinaria & Estética" width="120">
</p>

<h1 align="center">Omega Veterinaria & Estética — Panel Administrativo</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js_24+-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js 24+">
  <img src="https://img.shields.io/badge/Express_5-000000?style=flat&logo=express&logoColor=white" alt="Express 5">
  <img src="https://img.shields.io/badge/EJS-B4CA65?style=flat&logo=ejs&logoColor=black" alt="EJS">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://github.com/VikingKning/omega_hospvet/actions/workflows/ci.yml/badge.svg" alt="CI">
  <img src="https://img.shields.io/badge/status-en%20desarrollo-F00F35?style=flat" alt="En desarrollo">
</p>

## Tabla de contenido

- [Descripción](#descripción)
- [Stack tecnológico](#stack-tecnológico)
- [Requisitos](#requisitos)
- [Ejecución local](#ejecución-local)
- [Variables de entorno](#variables-de-entorno)
- [Arquitectura](#arquitectura)
- [Módulos y rutas principales](#módulos-y-rutas-principales)
- [API y endpoints](#api-y-endpoints)
  - [Convenciones HTTP](#convenciones-http)
  - [Autenticación y perfil](#autenticación-y-perfil)
  - [Catálogos administrativos](#catálogos-administrativos)
  - [Tutores y pacientes](#tutores-y-pacientes)
  - [Agenda](#agenda)
  - [Laboratorio y métricas](#laboratorio-y-métricas)
  - [Webhook de WhatsApp](#webhook-de-whatsapp)
- [Configuración de integraciones](#configuración-de-integraciones)
  - [Google Calendar](#google-calendar)
    - [Configuración inicial en Google Cloud](#configuración-inicial-en-google-cloud)
    - [Generar o renovar el token de Google](#generar-o-renovar-el-token-de-google)
    - [Configuración de la página pública de reservas](#configuración-de-la-página-pública-de-reservas)
  - [Correo SMTP con Nodemailer](#correo-smtp-con-nodemailer)
    - [Prueba local con Gmail](#prueba-local-con-gmail)
  - [Meta y WhatsApp Business](#meta-y-whatsapp-business)
    - [Crear la aplicación de prueba y obtener los valores](#crear-la-aplicación-de-prueba-y-obtener-los-valores)
    - [Qué hacer con el token de Meta](#qué-hacer-con-el-token-de-meta)
    - [Configurar y probar el webhook en localhost](#configurar-y-probar-el-webhook-en-localhost)
    - [Registrar plantillas de texto](#registrar-plantillas-de-texto)
    - [Registrar la plantilla de resultados con documento](#registrar-la-plantilla-de-resultados-con-documento)
    - [Checklist para pasar de pruebas a producción](#checklist-para-pasar-de-pruebas-a-producción)
  - [Claude API](#claude-api)
- [Scripts disponibles](#scripts-disponibles)
- [Seguridad](#seguridad)
- [Calidad y CI](#calidad-y-ci)
- [Deploy](#deploy)
- [Repositorio](#repositorio)

## Descripción

Panel administrativo para el personal de **Omega Veterinaria & Estética**. Es una aplicación web renderizada en el servidor con Node.js, Express y EJS, respaldada por PostgreSQL mediante Knex. El frontend usa HTML, CSS y JavaScript vanilla, con HTMX para actualizaciones parciales y sin bundler ni proceso de compilación.

El sistema incluye:

- Autenticación real, permisos granulares por usuario y sesiones persistidas en PostgreSQL.
- Bloqueo escalonado por intentos fallidos, cambio obligatorio de contraseña y expiración de sesión por inactividad o duración máxima.
- Catálogos de usuarios, doctores, áreas, tutores, pacientes y plantillas de WhatsApp.
- Agenda genérica por área con FullCalendar, altas, edición, confirmación y cancelación de citas.
- Importación periódica de reservas externas desde Google Calendar.
- Órdenes de laboratorio multiestudio, carga protegida de resultados y envío por correo o WhatsApp.
- Métricas de laboratorio con filtros de fecha y gráficas.
- Recepción de mensajes de WhatsApp y clasificación de intención mediante Claude API, limitada a etiquetas y respuestas predefinidas.

## Stack tecnológico

| Tecnología                                 | Uso                                                     |
| ------------------------------------------ | ------------------------------------------------------- |
| Node.js 24+ y Express 5                    | Runtime y servidor HTTP                                 |
| EJS                                        | Vistas renderizadas en el servidor                      |
| HTML, CSS y JavaScript vanilla             | Interfaz sin framework de cliente ni build step         |
| HTMX 2.0.10                                | Filtros, formularios y actualización parcial de vistas  |
| FullCalendar 6.1.21                        | Calendario interactivo de citas por área                |
| Chart.js 4.5.0                             | Gráficas de métricas de laboratorio                     |
| PostgreSQL y Knex                          | Persistencia, consultas, migraciones y seeds            |
| bcrypt                                     | Hash de contraseñas                                     |
| express-session y connect-pg-simple        | Sesiones persistidas en PostgreSQL                      |
| Joi                                        | Validación de entradas                                  |
| csrf-csrf                                  | Protección CSRF                                         |
| Helmet, express-rate-limit y sanitize-html | Cabeceras, limitación de escritura y defensa contra XSS |
| Multer y pdf-lib                           | Carga y procesamiento de resultados de laboratorio      |
| googleapis                                 | Sincronización con Google Calendar                      |
| Nodemailer                                 | Envío de resultados por correo SMTP                     |
| WhatsApp Cloud API                         | Webhook, respuestas y envío de resultados               |
| Claude API                                 | Clasificación cerrada de mensajes entrantes de WhatsApp |
| Pino y pino-http                           | Logging estructurado                                    |
| Jest y Supertest                           | Pruebas unitarias y de integración                      |
| PM2                                        | Administración del proceso en producción                |

Las librerías de navegador HTMX, FullCalendar y Chart.js están vendorizadas en `public/js/`; no se descargan desde CDN durante la ejecución.

## Requisitos

- Node.js 24 o superior.
- pnpm 11.21.0, fijado mediante `packageManager` en `package.json`.
- PostgreSQL accesible. El CI usa PostgreSQL 16.
- Git.

## Ejecución local

### 1. Clonar e instalar

```bash
git clone https://github.com/VikingKning/omega_hospvet.git
cd omega_hospvet
corepack enable
pnpm install
```

Si Corepack no está disponible, pnpm también se puede instalar con `npm install -g pnpm`.

### 2. Crear la base de datos

Con PostgreSQL en ejecución:

```bash
sudo -u postgres psql -c "CREATE USER omega_hospvet WITH PASSWORD 'tu_password';"
sudo -u postgres psql -c "CREATE DATABASE omega_hospvet OWNER omega_hospvet;"
```

### 3. Configurar el entorno

Para desarrollo local se recomienda usar `.env.localhost`, que está excluido de Git:

```bash
cp .env.example .env.localhost
```

Completa al menos:

```dotenv
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=omega_hospvet
DB_USER=omega_hospvet
DB_PASSWORD=tu_password

SESSION_SECRET=una-cadena-larga-aleatoria
LABS_RESULT_FILE_STORAGE=/ruta/absoluta/para/resultados

ADMIN_NOMBRE=Administrador
ADMIN_APELLIDOS=Omega
ADMIN_EMAIL=admin@omegavet.local
ADMIN_USERNAME=admin
ADMIN_PASSWORD=una-contraseña-inicial-segura
```

`LABS_RESULT_FILE_STORAGE` es obligatorio. Debe apuntar a una carpeta escribible y no debe ubicarse dentro de `public/`, porque los resultados se descargan únicamente mediante una ruta autenticada.

También se puede copiar `.env.example` a `.env` y utilizar los scripts sin el sufijo `:localhost`.

### 4. Migrar y sembrar

```bash
pnpm run migrate:localhost
pnpm run seed:localhost
```

Actualmente las migraciones crean 21 tablas y agregan las plantillas predeterminadas del sistema. Los seeds registran 81 permisos, 8 áreas iniciales, los catálogos de laboratorio y el usuario administrador.

### 5. Levantar el servidor

```bash
pnpm run dev:localhost
```

La aplicación queda disponible en:

- `http://localhost:3000/`: inicio de sesión.
- `http://localhost:3000/health`: health check, responde `{"status":"ok"}`.

El administrador inicial usa `ADMIN_USERNAME` y `ADMIN_PASSWORD`. Después del login, el sidebar muestra únicamente los módulos permitidos para la sesión.

## Variables de entorno

El archivo base, con comentarios de configuración, está en `.env.example`.

### Obligatorias para iniciar la aplicación

| Variable                   | Descripción                                    |
| -------------------------- | ---------------------------------------------- |
| `DB_HOST`                  | Host de PostgreSQL                             |
| `DB_PORT`                  | Puerto de PostgreSQL                           |
| `DB_NAME`                  | Base de datos                                  |
| `DB_USER`                  | Usuario de base de datos                       |
| `DB_PASSWORD`              | Contraseña de base de datos                    |
| `SESSION_SECRET`           | Firma de sesiones y tokens CSRF                |
| `LABS_RESULT_FILE_STORAGE` | Carpeta privada para resultados de laboratorio |

Las variables `ADMIN_*` son utilizadas por el seed del administrador. `ADMIN_PASSWORD` debe definirse antes de ejecutar el seed.

### Google Calendar — opcionales

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=
GOOGLE_SYNC_INTERVAL_MINUTES=10
```

Sin estas credenciales, la agenda interna sigue funcionando, pero el job de importación de reservas externas no inicia.

### WhatsApp y Claude — opcionales

```dotenv
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_APP_ID=
WHATSAPP_TEMPLATES_SYNC_INTERVAL_MINUTES=60

ANTHROPIC_API_KEY=
```

Las variables de WhatsApp habilitan el webhook, las respuestas y el envío de resultados. `WHATSAPP_APP_ID` solo es necesario para registrar la plantilla de resultados con documento adjunto. `ANTHROPIC_API_KEY` habilita el clasificador de mensajes entrantes; Claude solo devuelve una etiqueta permitida y nunca genera contenido médico libre.

### Correo — opcionales

```dotenv
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Omega Veterinaria & Estética <no-reply@example.com>
```

Usa `SMTP_SECURE=true` para TLS implícito, normalmente en el puerto 465. Sin una configuración SMTP completa, el canal de correo se omite y el resto de la aplicación continúa disponible.

## Arquitectura

La aplicación es un monolito modular. Cada dominio sigue, cuando aplica, esta separación:

```text
routes → controller → service → repository → PostgreSQL
```

- `routes`: URL, autenticación, permisos, CSRF y rate limiting.
- `controller`: adaptación HTTP y renderizado de vistas o fragmentos.
- `service`: reglas de negocio y validaciones del dominio.
- `repository`: consultas y transacciones de Knex.

Los listados y formularios parciales utilizan HTMX. Los filtros se envían normalmente por `POST`, de modo que nombres, teléfonos y búsquedas no queden registrados en la URL o el historial del navegador.

### Estructura principal

```text
OmegaVet_AdminSite/
├── .github/workflows/ci.yml
├── assets/sql/                    # SQL, DBML y diagrama del modelo
├── public/
│   ├── assets/imgs/
│   ├── css/
│   └── js/                        # JS propio y librerías vendorizadas
├── scripts/                       # Utilidades de Google y WhatsApp
├── src/
│   ├── config/                    # Entorno, BD, sesión e integraciones
│   ├── db/
│   │   ├── migrations/
│   │   └── seeds/
│   ├── jobs/                      # Sincronizaciones periódicas
│   ├── middlewares/
│   ├── modules/
│   │   ├── agenda/
│   │   ├── areas/
│   │   ├── auth/
│   │   ├── doctores/
│   │   ├── laboratorio/
│   │   ├── metricas/
│   │   ├── perfil/
│   │   ├── plantillas_whatsapp/
│   │   ├── tutores/
│   │   ├── usuarios/
│   │   └── whatsapp/
│   ├── views/                     # Páginas EJS y fragmentos HTMX
│   ├── app.js                     # Configuración de Express
│   └── server.js                  # Entrada y apagado ordenado
└── tests/
    ├── integration/
    └── unit/
```

`src/modules/grooming/` y `src/modules/doctores_areas/` son placeholders y no montan rutas propias. Grooming se atiende como un área mediante la agenda genérica.

## Módulos y rutas principales

| Ruta                         | Permiso                     | Función                                           |
| ---------------------------- | --------------------------- | ------------------------------------------------- |
| `/` y `/index.html`          | Pública                     | Inicio de sesión                                  |
| `/main.html`                 | Sesión                      | Dashboard principal                               |
| `/cambiar-password`          | Sesión                      | Cambio obligatorio de contraseña                  |
| `/mi-perfil.html`            | Sesión                      | Perfil y cambio voluntario de contraseña          |
| `/agenda/:slug.html`         | `agenda.<slug>.ver`         | Calendario por área                               |
| `/tutores.html`              | `tutores.ver`               | Tutores y pacientes                               |
| `/laboratorio.html`          | `laboratorio.ver`           | Órdenes y resultados de laboratorio               |
| `/metricas/laboratorio.html` | `metricas.laboratorios.ver` | Métricas de laboratorio                           |
| `/doctores.html`             | `doctores.ver`              | Catálogo de doctores y especialidades             |
| `/areas.html`                | `areas.ver`                 | Catálogo de áreas                                 |
| `/plantillas.html`           | `plantillas.ver`            | Plantillas de respuestas de WhatsApp              |
| `/usuarios.html`             | `usuarios.ver`              | Usuarios, estatus, permisos y reset de contraseña |
| `/webhooks/whatsapp`         | Firma/token de Meta         | Handshake y recepción del webhook                 |
| `/health`                    | Pública                     | Estado del servidor                               |

Las operaciones de creación, edición, cancelación, carga, envío y baja exigen sus permisos específicos. Las bajas de los catálogos son lógicas para conservar auditoría y relaciones históricas.

## API y endpoints

La aplicación no expone una API pública separada: sus endpoints sirven páginas EJS, fragmentos HTML para HTMX o JSON para interacciones concretas del panel. Todas las rutas se montan sobre el mismo servidor Express.

### Convenciones HTTP

- Las rutas públicas son el login, el health check y el webhook de Meta.
- El resto requiere una sesión válida mediante `requireAuth`.
- Cada módulo aplica permisos como `usuarios.ver`, `laboratorio.cargar` o `agenda.<slug>.editar`.
- Los `POST`, `PUT` y `DELETE` del panel usan protección CSRF y, salvo el login, el limitador general de 100 solicitudes por minuto por usuario.
- Los listados filtrados con HTMX envían sus criterios por `POST` para no exponer búsquedas en la URL.
- Una petición HTMX sin sesión o permiso recibe `HX-Redirect`; una navegación normal recibe una redirección HTTP.
- Las bajas de doctores, áreas, plantillas, tutores, usuarios y órdenes de laboratorio son lógicas.

### Autenticación y perfil

| Método | Ruta                  | Protección    | Respuesta/uso                                                    |
| ------ | --------------------- | ------------- | ---------------------------------------------------------------- |
| `GET`  | `/` o `/index.html`   | Pública       | Renderiza el login o redirige a `/main.html` si ya existe sesión |
| `POST` | `/login`              | CSRF + Joi    | Valida credenciales y devuelve JSON con el destino de navegación |
| `GET`  | `/logout`             | Pública       | Destruye la sesión actual y redirige al login                    |
| `GET`  | `/main.html`          | Sesión        | Dashboard principal                                              |
| `GET`  | `/cambiar-password`   | Sesión        | Pantalla de cambio obligatorio tras un reset administrativo      |
| `POST` | `/cambiar-password`   | Sesión + CSRF | Completa el cambio obligatorio y libera la sesión restringida    |
| `GET`  | `/mi-perfil.html`     | Sesión        | Datos y permisos del usuario autenticado                         |
| `POST` | `/mi-perfil.html`     | Sesión + CSRF | Actualiza nombre, apellidos, teléfono y correo propios           |
| `POST` | `/mi-perfil/password` | Sesión + CSRF | Cambia voluntariamente la contraseña propia                      |
| `GET`  | `/health`             | Pública       | Devuelve `200 {"status":"ok"}`                                   |

### Catálogos administrativos

Los endpoints `POST ...html` de esta tabla devuelven únicamente el fragmento HTML actualizado del listado.

| Módulo     | Lectura y filtro            | Formularios                                                                      | Escritura                                        |
| ---------- | --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Doctores   | `GET/POST /doctores.html`   | `GET /doctores/nuevo`, `GET /doctores/:id/editar`                                | `POST /doctores`, `PUT/DELETE /doctores/:id`     |
| Áreas      | `GET/POST /areas.html`      | `GET /areas/nuevo`, `GET /areas/:id/editar`                                      | `POST /areas`, `PUT/DELETE /areas/:id`           |
| Plantillas | `GET/POST /plantillas.html` | `GET /plantillas/nuevo`, `GET /plantillas/:id/ver`, `GET /plantillas/:id/editar` | `POST /plantillas`, `PUT/DELETE /plantillas/:id` |
| Usuarios   | `GET/POST /usuarios.html`   | `GET /usuarios/nuevo`, `GET /usuarios/:id/editar`                                | `POST /usuarios`, `PUT/DELETE /usuarios/:id`     |

Endpoints adicionales de usuarios:

- `POST /usuarios/username-sugerido`: propone un username disponible durante el alta.
- `POST /usuarios/:id/resetear-password`: genera la contraseña temporal, cambia el estatus a `cambio_pwd` e invalida las sesiones activas del usuario afectado.
- Si el formulario incluye una matriz de permisos, crear o editar exige también `usuarios.permisos`.

### Tutores y pacientes

| Método     | Ruta                             | Función                                                                |
| ---------- | -------------------------------- | ---------------------------------------------------------------------- |
| `GET/POST` | `/tutores.html`                  | Página completa y filtrado HTMX del catálogo                           |
| `GET`      | `/tutores/nuevo`                 | Formulario completo de alta                                            |
| `GET`      | `/tutores/:id/editar`            | Formulario completo de edición                                         |
| `POST`     | `/tutores`                       | Crea o reactiva un tutor con sus pacientes                             |
| `PUT`      | `/tutores/:id`                   | Edita al tutor y sus pacientes en una transacción                      |
| `DELETE`   | `/tutores/:id`                   | Baja lógica del tutor y de sus mascotas activas                        |
| `POST`     | `/tutores/buscar-telefono`       | Búsqueda incremental de tutores activos para el alta                   |
| `POST`     | `/tutores/verificar-telefono`    | Coincidencia exacta y detección de un tutor inactivo para reactivación |
| `POST`     | `/tutores/buscar-mascota`        | Busca pacientes desde el formulario de una cita                        |
| `POST`     | `/tutores/buscar-tutor-telefono` | Busca un tutor por teléfono desde Agenda                               |
| `POST`     | `/tutores/buscar-tutor-nombre`   | Busca un tutor por nombre desde Agenda                                 |

### Agenda

`:slug` identifica un área activa, por ejemplo `consultas`, `cirugias` o `grooming`.

| Método   | Ruta                                | Permiso                  | Función                                                      |
| -------- | ----------------------------------- | ------------------------ | ------------------------------------------------------------ |
| `GET`    | `/agenda/:slug.html`                | `agenda.<slug>.ver`      | Página de FullCalendar para el área                          |
| `GET`    | `/agenda/:slug/citas.json`          | `agenda.<slug>.ver`      | Feed de citas del rango visible                              |
| `GET`    | `/agenda/:slug/citas/ocupado.json`  | `agenda.<slug>.ver`      | Bloques ocupados del doctor en otras áreas                   |
| `GET`    | `/agenda/:slug/citas/nueva`         | `agenda.<slug>.crear`    | Fragmento del formulario de alta                             |
| `POST`   | `/agenda/:slug/citas`               | `agenda.<slug>.crear`    | Crea una cita y la sincroniza con Google si está configurado |
| `GET`    | `/agenda/:slug/citas/:id/editar`    | `agenda.<slug>.editar`   | Fragmento del formulario de edición                          |
| `PUT`    | `/agenda/:slug/citas/:id`           | `agenda.<slug>.editar`   | Actualiza una cita                                           |
| `POST`   | `/agenda/:slug/citas/:id/confirmar` | `agenda.<slug>.editar`   | Confirma una reserva externa pendiente                       |
| `DELETE` | `/agenda/:slug/citas/:id`           | `agenda.<slug>.cancelar` | Cancela lógicamente una cita                                 |

### Laboratorio y métricas

| Método        | Ruta                                           | Permiso                     | Función                                                       |
| ------------- | ---------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `GET/POST`    | `/laboratorio.html`                            | `laboratorio.ver`           | Página completa y filtrado HTMX de órdenes                    |
| `GET`         | `/laboratorio/nuevo`                           | `laboratorio.crear`         | Formulario de nueva orden                                     |
| `GET`         | `/laboratorio/:id/ver`                         | `laboratorio.ver`           | Consulta de una orden en modo solo lectura                    |
| `GET`         | `/laboratorio/:id/editar`                      | `laboratorio.ver`           | Abre la orden; el permiso de edición decide si es modificable |
| `POST`        | `/laboratorio`                                 | `laboratorio.crear`         | Crea una orden multiestudio                                   |
| `PUT`         | `/laboratorio/:id`                             | `laboratorio.editar`        | Actualiza una orden                                           |
| `DELETE`      | `/laboratorio/:id`                             | `laboratorio.eliminar`      | Baja lógica de la orden                                       |
| `POST`        | `/laboratorio/buscar-tutor`                    | `laboratorio.crear`         | Busca tutor por teléfono                                      |
| `POST`        | `/laboratorio/buscar-tutor-nombre`             | `laboratorio.crear`         | Busca tutor por nombre                                        |
| `GET`         | `/laboratorio/:id/cargar`                      | `laboratorio.cargar`        | Pantalla de carga de resultados                               |
| `POST/DELETE` | `/laboratorio/:id/archivos`                    | `laboratorio.cargar`        | Carga o elimina archivos generales de la orden                |
| `POST/DELETE` | `/laboratorio/:id/estudios/:estudioId/archivo` | `laboratorio.cargar`        | Carga o elimina el archivo de un estudio                      |
| `GET`         | `/laboratorio/archivos/:archivoId`             | `laboratorio.ver`           | Descarga autenticada de un resultado                          |
| `POST`        | `/laboratorio/:id/enviar`                      | `laboratorio.enviar`        | Envía los resultados por los canales configurados             |
| `GET/POST`    | `/metricas/laboratorio.html`                   | `metricas.laboratorios.ver` | Página y filtro HTMX de métricas por fecha                    |

Las cargas aceptan PDF, JPG, PNG, WebP, MP4, MOV y WebM. Multer limita cada archivo a 50 MB y cada lote a 10 archivos. Si se cargan varios archivos, solo JPG, PNG y PDF pueden fusionarse en un PDF; WebP y video deben cargarse individualmente. Los resultados se guardan bajo `LABS_RESULT_FILE_STORAGE`, nunca en `public/`.

### Webhook de WhatsApp

| Método | Ruta                 | Validación                           | Función                                    |
| ------ | -------------------- | ------------------------------------ | ------------------------------------------ |
| `GET`  | `/webhooks/whatsapp` | `WHATSAPP_WEBHOOK_VERIFY_TOKEN`      | Handshake que registra el callback en Meta |
| `POST` | `/webhooks/whatsapp` | Firma HMAC con `WHATSAPP_APP_SECRET` | Recibe mensajes, clasifica y responde      |

El webhook responde `200` a Meta después de validar la firma aunque el procesamiento interno falle, para evitar reintentos repetidos del mismo mensaje. El fallo queda registrado con Pino.

## Configuración de integraciones

### Google Calendar

La agenda interna utiliza FullCalendar y no depende de un iframe. Google Calendar es una integración opcional para importar reservas externas, reflejar cancelaciones o cambios y sincronizar las citas creadas por el panel. El job corre cada `GOOGLE_SYNC_INTERVAL_MINUTES` minutos; el valor predeterminado es 10.

#### Configuración inicial en Google Cloud

1. Crea o selecciona un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. Habilita **Google Calendar API**.
3. Configura la pantalla de consentimiento OAuth. En modo `Testing`, agrega como usuario de prueba la cuenta de Google que administra el calendario.
4. Crea credenciales OAuth de tipo **Web application**.
5. Registra exactamente este redirect URI:

   ```text
   http://localhost:3000/auth/google/callback
   ```

   Esa ruta la atiende temporalmente `scripts/renovar-google-token.js`, no la aplicación Express normal.

6. Copia el client ID y client secret a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
7. En Google Calendar, abre la configuración del calendario que se sincronizará y copia su identificador a `GOOGLE_CALENDAR_ID`.

El script solicita únicamente el scope `https://www.googleapis.com/auth/calendar.events`. Google documenta el flujo y las causas de expiración en [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2).

#### Generar o renovar el token de Google

Si el proyecto OAuth está publicado como `Testing`, Google expira normalmente el refresh token a los 7 días. En los logs aparece `invalid_grant` o `Token has been expired or revoked`; la aplicación sigue funcionando, pero la sincronización se detiene.

1. Detén `pnpm run dev:localhost`, porque el servidor y el script necesitan el puerto 3000.
2. Confirma que `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` estén en `.env.localhost`.
3. Ejecuta:

   ```bash
   pnpm run google:renovar-token
   ```

4. Abre la URL impresa en la terminal, inicia sesión con la cuenta correcta y acepta el permiso.
5. Copia la línea `GOOGLE_REFRESH_TOKEN=...` que imprime el script y reemplaza el valor anterior en `.env.localhost`.
6. Reinicia `pnpm run dev:localhost`. El arranque debe registrar que la sincronización de Google Calendar está activa.

Si Google no devuelve un refresh token, elimina el acceso previo de `omega-hosp-vet-calsync` en [Permisos de la cuenta de Google](https://myaccount.google.com/permissions) y repite el proceso. En QA o producción, guarda el token nuevo en el gestor de secretos o archivo de entorno correspondiente y reinicia PM2; no lo copies al repositorio.

#### Configuración de la página pública de reservas

El sistema reconoce únicamente la página de reservas de Consultas. Debe conservar:

- Un título que contenga `Consultas Veterinarias`.
- La frase `Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla.` en la descripción.
- Las etiquetas exactas `Teléfono`, `Nombre de la Mascota` y `Motivo de Consulta` en las preguntas personalizadas.

Las reservas reconocidas se importan en el área Consultas. Si teléfono y mascota coinciden con datos existentes, pueden quedar confirmadas; si no, se registran pendientes para que el personal complete la información.

Las reservas importadas utilizan el doctor genérico `Consultas Omega Generico`, creado automáticamente si no existe. No debe renombrarse ni eliminarse: la sincronización lo localiza por ese nombre exacto.

### Correo SMTP con Nodemailer

Nodemailer crea y reutiliza un transporter SMTP cuando están presentes `SMTP_HOST`, `SMTP_USER` y `SMTP_PASSWORD`. Si falta alguno, el correo se omite sin deshabilitar el resto del sistema.

Configuración general con STARTTLS:

```dotenv
SMTP_HOST=smtp.del-proveedor.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario
SMTP_PASSWORD=contraseña-o-token
SMTP_FROM=Omega Veterinaria & Estética <no-reply@dominio.com>
```

Para TLS implícito se usa normalmente el puerto 465 con `SMTP_SECURE=true`. `SMTP_FROM` es el remitente visible; el proveedor debe autorizar a `SMTP_USER` para enviar con esa dirección.

#### Prueba local con Gmail

Este proyecto usa autenticación SMTP por usuario y contraseña, no OAuth para correo. Para Gmail debe utilizarse una contraseña de aplicación:

1. Inicia sesión en la cuenta destinada a pruebas.
2. Activa la [verificación en dos pasos](https://myaccount.google.com/security).
3. Genera una [contraseña de aplicación](https://myaccount.google.com/apppasswords). Google solo muestra sus 16 caracteres una vez.
4. Configura `.env.localhost`:

   ```dotenv
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=cuenta-de-prueba@gmail.com
   SMTP_PASSWORD=contraseña-de-aplicación-sin-espacios
   SMTP_FROM=Omega Veterinaria & Estética <cuenta-de-prueba@gmail.com>
   ```

5. Reinicia el servidor; las variables se leen al arrancar.
6. Usa un tutor con correo, carga todos los resultados de una orden y ejecuta **Enviar resultados**. La interfaz indica si el canal de correo tuvo éxito.

No uses la contraseña normal de Gmail. Google exige verificación en dos pasos para crear contraseñas de aplicación y puede revocarlas al cambiar la contraseña principal; consulta [Sign in with app passwords](https://support.google.com/accounts/answer/185833). Para el puerto 587, Gmail documenta TLS/STARTTLS en su [configuración SMTP](https://support.google.com/mail/answer/7104828).

En producción se recomienda una cuenta o servicio SMTP dedicado. Después de rotar una contraseña o token SMTP, actualiza el secreto del entorno y reinicia PM2.

### Meta y WhatsApp Business

La integración usa llamadas `fetch` directas a WhatsApp Cloud API, sin SDK. La versión fijada en `src/config/whatsapp.js` es Graph API `v23.0`.

#### Crear la aplicación de prueba y obtener los valores

1. Entra a [Meta for Developers](https://developers.facebook.com/), crea una app de tipo negocio y agrega el producto **WhatsApp**.
2. En **WhatsApp → API Setup**, selecciona o crea la cuenta de WhatsApp Business de prueba.
3. Copia los valores del panel:
   - Token de acceso → `WHATSAPP_TOKEN`.
   - Phone number ID → `WHATSAPP_PHONE_NUMBER_ID`.
   - WhatsApp Business Account ID → `WHATSAPP_BUSINESS_ACCOUNT_ID`.
4. En la configuración básica de la app copia:
   - App ID → `WHATSAPP_APP_ID`.
   - App Secret → `WHATSAPP_APP_SECRET`.
5. Inventa una cadena larga y aleatoria para `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. No la genera Meta; solo debe coincidir entre Meta y el servidor.
6. Agrega y verifica en el panel los teléfonos destinatarios que usarás durante las pruebas. El número de prueba solo puede enviar a los destinatarios permitidos por esa configuración.

Variables locales completas:

```dotenv
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_APP_ID=
WHATSAPP_TEMPLATES_SYNC_INTERVAL_MINUTES=60
```

`WHATSAPP_APP_ID` solo participa en el registro de la plantilla con documento; no se usa para enviar mensajes cotidianos. `WHATSAPP_BUSINESS_ACCOUNT_ID` identifica el catálogo de plantillas y `WHATSAPP_PHONE_NUMBER_ID` identifica el endpoint de mensajes y archivos.

La documentación oficial de referencia es [WhatsApp Cloud API: Get Started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started), [Set up Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks) y [Message Templates](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates).

#### Qué hacer con el token de Meta

El token mostrado por **API Setup** es temporal y se usa para desarrollo:

1. Copia el token nuevo a `WHATSAPP_TOKEN` en `.env.localhost`.
2. Reinicia `pnpm run dev:localhost`; el proceso no relee variables en caliente.
3. Repite cualquier prueba o script que hubiera fallado por token expirado.

Para producción, genera un token de larga duración mediante un usuario del sistema de Meta Business con acceso a la app y a la cuenta de WhatsApp. Debe contar con los permisos que correspondan a envío y administración de plantillas, normalmente `whatsapp_business_messaging` y `whatsapp_business_management`. Guarda el token únicamente en el entorno del servidor. Cuando se rote o revoque, reemplaza `WHATSAPP_TOKEN` y ejecuta `pm2 restart omega-vet-adminsite --update-env`.

#### Configurar y probar el webhook en localhost

Meta necesita una URL HTTPS pública. Un quick tunnel de Cloudflare sirve para pruebas, pero genera una URL nueva cada vez:

```bash
# Terminal 1
pnpm run dev:localhost

# Terminal 2
cloudflared tunnel --url http://localhost:3000
```

Después:

1. Copia la URL `https://<subdominio>.trycloudflare.com` mostrada por cloudflared.
2. En **Meta for Developers → WhatsApp → Configuration → Webhook**, registra:
   - Callback URL: `https://<subdominio>.trycloudflare.com/webhooks/whatsapp`.
   - Verify Token: el valor exacto de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
3. Pulsa **Verify and save** con el servidor y el túnel todavía activos.
4. Suscribe el campo `messages` para la cuenta de WhatsApp.
5. Envía un mensaje desde uno de los teléfonos de prueba al número mostrado por Meta.
6. Revisa la respuesta en WhatsApp y los logs del servidor.

El `GET` del webhook hace el handshake con el verify token. Cada `POST` posterior se valida mediante `X-Hub-Signature-256` y `WHATSAPP_APP_SECRET`. Si cambia la URL del quick tunnel, actualiza el Callback URL en Meta. Al cerrar cloudflared no hay que eliminar nada: la URL simplemente deja de responder.

Para una URL estable de QA o producción, usa el dominio HTTPS real y conserva la ruta `/webhooks/whatsapp`.

#### Registrar plantillas de texto

Las altas y reactivaciones del catálogo intentan registrar su plantilla `UTILITY` en Meta de forma inmediata. Para registrar en lote todas las plantillas activas:

```bash
pnpm run whatsapp:registrar-plantillas
```

Este script:

- Lee las plantillas activas de PostgreSQL.
- Convierte el slug a un nombre compatible con Meta.
- Usa idioma `es_MX` y categoría `UTILITY`.
- Excluye `resultados-laboratorio-listos`, porque requiere un encabezado de documento.
- Imprime el código HTTP y la respuesta de Meta para cada registro.

Después de ejecutarlo:

1. Guarda o revisa cualquier error mostrado en la terminal. Un nombre ya registrado puede producir un error de duplicado.
2. Consulta el estado con:

   ```bash
   pnpm run whatsapp:estado-plantillas
   ```

3. Espera `APPROVED`. Si aparece `REJECTED`, revisa `motivo_rechazo`, corrige la plantilla según Meta y vuelve a registrarla con un nombre válido cuando corresponda.
4. El job `plantillasWhatsappMetaSyncJob` consulta Meta cada `WHATSAPP_TEMPLATES_SYNC_INTERVAL_MINUTES` minutos y cambia `aprobado_meta=true` en la base cuando detecta `APPROVED`.

Importante: el job periódico solo consulta aprobaciones; no reintenta un registro que falló. Editar el texto local de una plantilla ya registrada tampoco actualiza automáticamente la versión de Meta.

#### Registrar la plantilla de resultados con documento

La notificación de resultados puede iniciar una conversación fuera de la ventana de atención y adjunta un archivo. Por ello necesita la plantilla `resultados_laboratorio_listos`, categoría `UTILITY`, idioma `es_MX`, con encabezado `DOCUMENT`.

Antes de registrarla:

1. Ejecuta las migraciones para asegurar que exista y esté activa la fila `resultados-laboratorio-listos`.
2. Configura `WHATSAPP_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID` y `WHATSAPP_APP_ID`.
3. Confirma que el token todavía sea válido.

Ejecuta una sola vez por cuenta o cuando la plantilla deba crearse nuevamente:

```bash
pnpm run whatsapp:registrar-plantilla-resultados
```

El script genera un PDF de ejemplo con `pdf-lib`, abre una sesión de Resumable Upload, sube el ejemplo, recibe el `header_handle` y crea la plantilla. El archivo real de cada paciente se sube después, durante el envío desde Laboratorio.

Después de correrlo:

1. Verifica que la terminal muestre una respuesta HTTP exitosa y el identificador de Meta.
2. Ejecuta periódicamente `pnpm run whatsapp:estado-plantillas` hasta ver `APPROVED`.
3. Cuando esté aprobada, reinicia el servidor si cambiaste algún secreto y prueba **Enviar resultados** con un tutor cuyo teléfono esté autorizado como destinatario de prueba.
4. Si el número sigue siendo el de prueba, Meta solo entregará el mensaje a teléfonos verificados en el panel.

No ejecutes repetidamente el registro si la plantilla ya existe: Meta conserva los nombres y puede rechazar el duplicado. La aprobación puede tardar y no implica que cualquier destinatario sea válido mientras se utilice el número de prueba.

#### Checklist para pasar de pruebas a producción

- La app y la cuenta de WhatsApp Business deben quedar bajo la organización propietaria, no bajo una cuenta personal del desarrollador.
- Registra y valida el número real que utilizará la clínica.
- Sustituye el token temporal por el token de larga duración del usuario del sistema.
- Cambia `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_BUSINESS_ACCOUNT_ID` si los recursos productivos son distintos.
- Configura el webhook con una URL HTTPS estable y vuelve a suscribir el campo `messages`.
- Conserva el mismo `WHATSAPP_WEBHOOK_VERIFY_TOKEN` en Meta y el servidor, y actualiza `WHATSAPP_APP_SECRET` si cambia la app.
- Confirma que `resultados_laboratorio_listos` esté `APPROVED` para la cuenta productiva; la aprobación de la cuenta de prueba no se transfiere automáticamente a otra WABA.
- Reinicia con `pm2 restart omega-vet-adminsite --update-env` y realiza una prueba controlada de recepción y otra de envío de resultados.

### Claude API

Configura `ANTHROPIC_API_KEY` para procesar mensajes entrantes. El cliente usa `fetch` nativo con el modelo fijo `claude-haiku-4-5-20251001` y no necesita el SDK de Anthropic.

Claude realiza dos niveles de clasificación cerrada:

1. Categoría: `emergencia`, `duda_medica`, `agendar_cita` o `resultados_laboratorio`.
2. Para `duda_medica`, intención contra las plantillas activas del catálogo.

La salida se acepta únicamente si coincide exactamente con una etiqueta permitida. Las respuestas al tutor siempre proceden de `plantillas_whatsapp`; el modelo no redacta recomendaciones médicas.

Después de agregar o rotar `ANTHROPIC_API_KEY`, reinicia el proceso. Para una prueba completa se necesitan también el webhook de Meta, `WHATSAPP_TOKEN`, un destinatario permitido y plantillas activas en la base. Si Claude o el envío falla, el webhook responde `200` para evitar reintentos agresivos de Meta y registra el error para revisión.

## Scripts disponibles

| Script                                             | Descripción                                                 |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm start`                                       | Inicia `src/server.js` con las variables del entorno actual |
| `pnpm run dev`                                     | Inicia con `node --watch`, usando `.env`                    |
| `pnpm run dev:localhost`                           | Inicia con `node --watch`, cargando `.env.localhost`        |
| `pnpm run migrate`                                 | Aplica migraciones usando `.env`                            |
| `pnpm run migrate:rollback`                        | Revierte el último lote de migraciones                      |
| `pnpm run migrate:status`                          | Muestra el estado de las migraciones                        |
| `pnpm run migrate:localhost`                       | Aplica migraciones con `.env.localhost`                     |
| `pnpm run migrate:test`                            | Aplica migraciones con `.env.test`                          |
| `pnpm run seed`                                    | Ejecuta seeds usando `.env`                                 |
| `pnpm run seed:localhost`                          | Ejecuta seeds con `.env.localhost`                          |
| `pnpm run seed:test`                               | Ejecuta seeds con `.env.test`                               |
| `pnpm run google:renovar-token`                    | Renueva el refresh token de Google Calendar                 |
| `pnpm run whatsapp:registrar-plantillas`           | Registra en Meta las plantillas activas de texto            |
| `pnpm run whatsapp:estado-plantillas`              | Consulta el estado de aprobación en Meta                    |
| `pnpm run whatsapp:registrar-plantilla-resultados` | Registra la plantilla de resultados con PDF                 |
| `pnpm run lint`                                    | Ejecuta ESLint                                              |
| `pnpm run lint:fix`                                | Ejecuta ESLint con correcciones automáticas                 |
| `pnpm run format`                                  | Formatea el repositorio con Prettier                        |
| `pnpm run format:check`                            | Verifica el formato sin modificar archivos                  |
| `pnpm test`                                        | Ejecuta pruebas unitarias e integración                     |

`pnpm start` no establece por sí mismo `NODE_ENV=production`; debe definirse en el entorno. PM2 sí lo establece mediante `ecosystem.config.js`.

## Seguridad

- Contraseñas almacenadas con bcrypt, costo 12.
- Sesión regenerada al autenticar para prevenir session fixation.
- Expiración por 30 minutos de inactividad y tope absoluto de 8 horas.
- Cookies `httpOnly`, `sameSite=lax` y `secure` en producción.
- Content Security Policy con nonce por petición; `script-src` no usa `unsafe-inline`.
- `frame-src 'self'`; la agenda ya no depende de iframes de Google.
- Protección CSRF en login y rutas protegidas que usan métodos de escritura.
- Rate limit de 100 solicitudes por minuto para rutas de escritura.
- Sanitización recursiva de cuerpos para reducir XSS almacenado.
- Descarga autenticada de resultados de laboratorio.
- Verificación HMAC de los webhooks entrantes de Meta.
- Errores y 404 centralizados; Pino registra respuestas fallidas de forma estructurada.

## Calidad y CI

El repositorio usa ESLint con flat config y Prettier. Las pruebas se dividen en:

- `tests/unit/`: reglas de negocio con repositories y servicios externos simulados.
- `tests/integration/`: Express completo con Supertest y PostgreSQL real de pruebas.

GitHub Actions ejecuta en cada push y pull request contra `main`:

1. Instalación con lockfile congelado.
2. ESLint.
3. Verificación de Prettier.
4. Migraciones y seeds en PostgreSQL 16 efímero.
5. Suite completa de Jest.

## Deploy

La configuración incluida usa una instancia de PM2 en modo `fork`, reinicio automático y límite de memoria de 300 MB:

```bash
pnpm install --prod --frozen-lockfile
pnpm run migrate
pnpm run seed
pm2 start ecosystem.config.js
pm2 save
```

Los comandos anteriores asumen que PM2 está instalado en el servidor. El deploy es manual. `ecosystem.config.js` establece `NODE_ENV=production`; las variables sensibles deben proporcionarse en el entorno del servidor y no versionarse.

## Repositorio

- Panel administrativo: [github.com/VikingKning/omega_hospvet](https://github.com/VikingKning/omega_hospvet)
