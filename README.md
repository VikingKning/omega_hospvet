<p align="center">
  <img src="public/assets/imgs/icon.png" alt="Omega Veterinaria & Estética" width="120">
</p>

<h1 align="center">Omega Veterinaria & Estética — Panel Administrativo</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/EJS-B4CA65?style=flat&logo=ejs&logoColor=black" alt="EJS">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://github.com/VikingKning/omega_hospvet/actions/workflows/ci.yml/badge.svg" alt="CI">
  <img src="https://img.shields.io/badge/status-en%20desarrollo-F00F35?style=flat" alt="En desarrollo">
</p>

---

## Tabla de contenido

- [Descripción](#descripción)
- [Prerequisitos para ejecución](#prerequisitos-para-ejecución)
- [Cómo correr el proyecto en localhost](#cómo-correr-el-proyecto-en-localhost)
- [Arquitectura](#arquitectura)
  - [Configuración de entorno](#configuración-de-entorno)
  - [Stack tecnológico](#stack-tecnológico)
  - [Estructura del proyecto](#estructura-del-proyecto)
  - [Rutas](#rutas)
  - [API](#api)
  - [Scripts disponibles](#scripts-disponibles)
  - [Calidad y CI](#calidad-y-ci)
- [Deploy](#deploy)
- [Repositorios](#repositorios)

---

## Descripción

Panel administrativo para **Omega Veterinaria & Estética**: una interfaz web para el personal de la clínica que cubre inicio de sesión real (contraseñas con bcrypt, sesión persistida en PostgreSQL, permisos por usuario), un dashboard principal con menú lateral colapsable que solo muestra los módulos a los que el usuario tiene acceso, un módulo de **Agenda** (Consultas y Cirugías, Grooming) con calendario de Google embebido y semáforo de puntualidad de citas, y un módulo de **Laboratorio** con alta de órdenes multi-estudio (catálogo por categoría/estudio/zona anatómica), filtros de búsqueda y carga simulada de resultados.

El frontend (HTML + CSS + JavaScript vanilla, sin frameworks de cliente ni proceso de build) se renderiza server-side con Express + EJS, sobre el backend (Node.js + Express + PostgreSQL vía Knex) que se está construyendo por historias de usuario a partir de la Fase 0 de infraestructura (US-000). El HTML/JS/CSS de cada página no cambió respecto al PoC original — solo cambió quién lo sirve. Única excepción: `/doctores.html` y `/areas.html` usan [HTMX](https://htmx.org/) (vendored en `public/js/`, sin CDN externo, sin build step) para actualizar el panel de filtros/tabla sin recargar la página y sin exponer lo que se busca/filtra en la URL — mismo patrón en ambas, es el estándar del sistema para listados con filtro/orden/paginación; ver la sección de doctores más abajo.

## Prerequisitos para ejecución

- [Node.js](https://nodejs.org/) 24+ (LTS activa; pnpm 11 exige como mínimo 22.13, pero 22 ya pasó a Maintenance LTS en octubre 2025) y [pnpm](https://pnpm.io/) (gestor de paquetes decidido en la bitácora técnica; `npm install -g pnpm` o `corepack enable` si tu instalación de Node lo soporta).
- Una instancia de [PostgreSQL](https://www.postgresql.org/) accesible (local o remota).
- [Git](https://git-scm.com/) para clonar el repositorio.

## Cómo correr el proyecto en localhost

### 1. Clonar el repositorio

```bash
git clone https://github.com/VikingKning/omega_hospvet.git
cd omega_hospvet
```

### 2. Instalar pnpm (si no lo tienes) y las dependencias

```bash
npm install -g pnpm   # o: corepack enable (si tu instalación de Node lo soporta)
pnpm install
```

Si tu usuario no tiene permisos de escritura sobre el prefix global de npm/node (por ejemplo `/usr`), instala pnpm en un prefix propio y agrégalo al `PATH`:

```bash
npm config set prefix ~/.npm-global
npm install -g pnpm
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc   # o ~/.zshrc según tu shell
source ~/.bashrc
```

### 3. Crear la base de datos en PostgreSQL

Necesitas una instancia de PostgreSQL accesible (local o remota) y un rol/base de datos dedicados. En local, con el servicio de PostgreSQL ya corriendo:

```bash
sudo -u postgres psql -c "CREATE USER omega_hospvet WITH PASSWORD 'tu_password';"
sudo -u postgres psql -c "CREATE DATABASE omega_hospvet OWNER omega_hospvet;"
```

### 4. Configurar las variables de entorno

Hay dos formas de hacerlo:

- **Atajo recomendado para desarrollo local**: crea (o edita) tu propio `.env.localhost` con tus credenciales locales (está excluido de git, cada desarrollador tiene el suyo). Los scripts `*:localhost` (paso 5 y 6) lo leen directamente vía `dotenv-cli`, sin tocar nunca el archivo `.env`.
- **Manual, usando `.env`**: `cp .env.example .env` y completa a mano.

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=omega_hospvet
DB_USER=omega_hospvet
DB_PASSWORD=tu_password

SESSION_SECRET=cualquier-cadena-larga-y-aleatoria

ADMIN_PASSWORD=elige-una-contraseña-para-el-admin
```

(`ADMIN_NOMBRE`, `ADMIN_APELLIDOS`, `ADMIN_EMAIL`, `ADMIN_USERNAME` ya traen valores por defecto en `.env.example`.) Cualquier variante `.env*` queda excluida de git (salvo `.env.example`, ver `.gitignore`) — nunca se sube al repositorio.

### 5. Ejecutar migraciones y seeds

```bash
pnpm run migrate:localhost   # o: pnpm run migrate, si usas .env
pnpm run seed:localhost      # o: pnpm run seed
```

Esto crea las 20 tablas del Modelo de Datos v4 más sus foreign keys, y siembra `permissions` (33 permisos), los catálogos de laboratorio (categorías/estudios/zonas anatómicas) y el usuario administrador de arranque con `ADMIN_USERNAME`/`ADMIN_PASSWORD` del archivo de entorno usado.

### 6. Levantar el servidor

```bash
pnpm run dev:localhost   # o: pnpm run dev, si usas .env
```

Deberías ver en consola: `Omega Vet AdminSite escuchando en el puerto 3000 (development)`. Para detenerlo, `Ctrl+C` en esa misma terminal.

### 7. Probar en el navegador

- `http://localhost:3000/` → debe cargar la pantalla de inicio de sesión (`index.html`, servida por Express).
- `http://localhost:3000/health` → debe responder `{"status":"ok"}`.
- Inicia sesión con `ADMIN_USERNAME`/`ADMIN_PASSWORD` de tu archivo de entorno (el login ya es real: valida contra `usuarios.password_hash` con bcrypt, no solo en el cliente). Te lleva a `main.html`, con el sidebar mostrando únicamente los módulos para los que tienes permiso (el admin sembrado tiene todos). Desde ahí puedes navegar `agenda.html`, `grooming.html`, `laboratorio.html`, `doctores.html`, `areas.html` — todas protegidas por sesión y por permiso (intentar entrar por URL directa sin el permiso correspondiente te regresa a `main.html`). `doctores.html`/`areas.html` arrancan vacíos (sin datos sembrados) — verás el estado vacío con el botón de alta correspondiente hasta que se dé de alta el primer registro. En `areas.html` ese botón ya funciona (US-610); en `doctores.html` sigue siendo decorativo (el alta real de doctores es una historia futura).
- "Cerrar sesión" en el sidebar destruye la sesión de verdad.
- Para confirmar que el seed del admin quedó bien, puedes consultarlo directo en la base: `psql -U omega_hospvet -d omega_hospvet -c "select username, correo, ultimo_login_en from usuarios;"` (ajusta usuario/base a los de tu `.env.localhost`; `ultimo_login_en` se actualiza en cada login exitoso).

## Arquitectura

### Configuración de entorno

Las credenciales y configuración sensible viven en `.env` (excluido de control de versiones). `.env.example` documenta las variables requeridas: conexión a PostgreSQL, `SESSION_SECRET` (firma las cookies de sesión y, reutilizado, los tokens CSRF) y los datos del usuario administrador de arranque (`ADMIN_*`, consumidos por el seed `05_admin_usuario.js`). `.env.test` es la excepción: son credenciales dummy para una base de datos descartable, sin secretos reales, por eso sí está versionado (usado por `pnpm test` y por el job de CI).

Además, el **ID del calendario de Google** se embebe manualmente en `src/views/agenda.ejs` y `src/views/grooming.ejs`:

```
src="https://calendar.google.com/calendar/embed?src=CALENDAR_ID%40group.calendar.google.com&..."
```

Debe reemplazarse `CALENDAR_ID` por el ID real de cada calendario (Google Calendar → Configuración → Integrar calendario), y ese calendario debe estar compartido públicamente para que el embed funcione sin iniciar sesión.

### Stack tecnológico

| Tecnología                          | Uso                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js + Express                   | Servidor de la aplicación web                                                                                                                 |
| EJS                                 | Motor de vistas server-side (`src/views/*.ejs` + `src/views/partials/`)                                                                       |
| CSS3 (vanilla)                      | Sistema de diseño propio, sin frameworks (`public/css/styles.css` + `public/css/main.css`)                                                    |
| JavaScript (ES6+)                   | Interactividad de cliente: menú, filtros, modales, semáforo, combobox de búsqueda (embebido en cada vista, sin cambios respecto al PoC)       |
| PostgreSQL + Knex                   | Base de datos y migraciones/seeds versionados                                                                                                 |
| bcrypt                              | Hash de contraseñas (`usuarios.password_hash`)                                                                                                |
| express-session + connect-pg-simple | Sesiones persistidas en PostgreSQL, sin Redis (Decisión 4 de la bitácora)                                                                     |
| csrf-csrf                           | Protección CSRF en formularios que modifican estado (login por ahora)                                                                         |
| Joi                                 | Validación de entrada en endpoints (`auth.schema.js` + `validate.js`)                                                                         |
| PM2                                 | Gestión del proceso en producción (`ecosystem.config.js`)                                                                                     |
| Google Calendar Embed               | Visualización de citas en Agenda/Grooming                                                                                                     |
| HTMX (vendored, sin CDN)            | `/doctores.html` y `/areas.html`: actualización parcial del panel sin exponer filtros en la URL (single-file, sin build step ni dependencias) |

### Estructura del proyecto

```
OmegaVet_AdminSite/
├── .github/workflows/ci.yml                       # GitHub Actions: lint + tests en cada push/PR
├── assets/
│   └── sql/                                       # Omega-Database.sql, modelo DBML y ERD (fuente del esquema, NO se sirve públicamente)
├── public/                                        # Estáticos servidos por Express (express.static)
│   ├── css/                                       # styles.css, main.css
│   ├── js/                                        # htmx.min.js (vendored, sin CDN); el resto del JS de cada vista sigue inline en el .ejs
│   └── assets/imgs/                               # Logotipos e íconos de la marca
├── src/
│   ├── config/                                    # env.js, database.js (Knex), logger.js (Pino), session.js, csrf.js
│   ├── db/
│   │   ├── migrations/                            # Una migración por tabla + FKs + tabla session
│   │   ├── seeds/                                 # Catálogos base y usuario admin de arranque
│   │   └── knexfile.js                            # Config real de Knex (migrations/seeds relativas a esta carpeta)
│   ├── middlewares/                                # errorHandler.js, requireAuth.js, requirePermission.js, validate.js, hxRedirect.js
│   ├── modules/
│   │   ├── auth/                                   # auth.routes/controller/service/repository/schema.js (US-101)
│   │   ├── doctores/                                # doctores.routes/controller/service/repository.js (US-606/608, filtro + baja vía HTMX)
│   │   └── areas/                                   # areas.routes/controller/service/repository.js (US-609/610/611)
│   ├── views/
│   │   ├── partials/sidebar.ejs                    # Sidebar compartido, filtrado por permisos (AC6 de US-101)
│   │   ├── partials/doctores-panel.ejs             # Fragmento HTMX de /doctores.html (toolbar+tabla+paginación)
│   │   ├── partials/areas-panel.ejs                # Fragmento HTMX de /areas.html (mismo patrón)
│   │   ├── partials/area-form.ejs                  # Formulario de alta/edición de áreas (US-610), un solo template para las dos acciones
│   │   ├── partials/areas-panel-oob.ejs             # Envoltura hx-swap-oob para refrescar la tabla tras un alta/edición desde el modal
│   │   └── index.ejs, main.ejs, agenda.ejs, grooming.ejs, laboratorio.ejs, doctores.ejs, areas.ejs
│   ├── app.js                                      # App Express (view engine EJS, helmet, compression, logging, sesión, rutas)
│   └── server.js                                   # Punto de entrada (graceful shutdown)
├── tests/
│   ├── unit/                                       # Jest — lógica de negocio, mockeando el repository (sin BD)
│   │   ├── auth.service.test.js
│   │   ├── doctores.service.test.js
│   │   └── areas.service.test.js
│   └── integration/                                # Jest + Supertest — app Express completa contra BD real
│       ├── app.test.js                             # Rutas públicas, 404, páginas protegidas sin sesión
│       ├── auth.test.js                            # Flujo de login completo (AC1-AC6 de US-101)
│       ├── doctores.test.js                        # Catálogo de doctores: poblado, búsqueda, permisos, orden, baja (US-606/608)
│       └── areas.test.js                            # Catálogo de áreas: poblado, búsqueda, permisos, orden, alta, edición, baja (US-609/610/611)
├── eslint.config.js
├── .prettierrc, .prettierignore
├── jest.config.js                                  # setupFiles carga .env.test para los tests
├── .editorconfig
├── knexfile.js                                     # Re-export delgado de src/db/knexfile.js (para `knex` sin --knexfile)
├── ecosystem.config.js                             # Configuración de PM2
├── .env.example
└── .env.test                                        # Credenciales dummy para pnpm test / CI (sin secretos reales)
```

### Rutas

| Ruta                | Protección                                             | Descripción                                                                                    |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `/` y `/index.html` | Pública (redirige a `/main.html` si ya hay sesión)     | Inicio de sesión (antes `login.html`; ahora es la página raíz)                                 |
| `POST /login`       | CSRF + Joi                                             | Valida credenciales, crea sesión, resuelve permisos (US-101)                                   |
| `GET /logout`       | —                                                      | Destruye la sesión y redirige a `/`                                                            |
| `/main.html`        | `requireAuth`                                          | Panel administrativo (landing tras iniciar sesión)                                             |
| `/agenda.html`      | `requireAuth` + `requirePermission('agenda.ver')`      | Agenda de Consultas y Cirugías                                                                 |
| `/grooming.html`    | `requireAuth` + `requirePermission('grooming.ver')`    | Agenda de Grooming                                                                             |
| `/laboratorio.html` | `requireAuth` + `requirePermission('laboratorio.ver')` | Órdenes de laboratorio, filtros y alta de estudios                                             |
| `/doctores.html`    | `requireAuth` + `requirePermission('doctores.ver')`    | Catálogo de doctores: listado, búsqueda, orden, paginación y baja (US-606/608)                 |
| `/areas.html`       | `requireAuth` + `requirePermission('areas.ver')`       | Catálogo de áreas: listado, búsqueda, orden, paginación, alta, edición y baja (US-609/610/611) |
| `/health`           | Pública                                                | Health check del servidor Express                                                              |

Las páginas del panel se sirven vía Express con `res.render()` (motor EJS); ya no existen archivos `.html` sueltos en la raíz del repositorio. Las URLs conservan la extensión `.html` a propósito, para no romper los enlaces del sidebar/navegación ya escritos en cada vista. `public/` (vía `express.static`) sirve `css/`, `js/` y `assets/imgs/*`; `assets/sql/` (el esquema de la base de datos) nunca se expone.

Desde US-101, `main.html`/`agenda.html`/`grooming.html`/`laboratorio.html`/`doctores.html`/`areas.html` requieren sesión activa (`requireAuth`, redirige a `/` si no hay sesión o si superó el tope absoluto de 8-12h) y, salvo `main.html`, el permiso exacto del módulo (`requirePermission`, redirige a `/main.html` si falta — nunca un 403 crudo). El sidebar (`src/views/partials/sidebar.ejs`, compartido por todas las vistas) filtra cada ítem por el mismo permiso: un módulo sin acceso ni se ve en el menú ni es alcanzable por URL directa (AC6 de US-101).

**`/doctores.html` (US-606) y `/areas.html` (US-609)** siguen el mismo patrón — la tabla estándar del sistema, decidida explícitamente así por el cliente para cualquier catálogo nuevo: `routes → controller → service → repository` del documento de Arquitectura y Buenas Prácticas, en vez de servir HTML estático del PoC. Cada una tiene búsqueda (doctores: por nombre o área, sin ocultar las demás áreas del doctor que hizo match; áreas: por nombre o slug), filtro Activos/Todos, paginación y orden por columna (clic en el header — invierte la dirección si ya se está ordenando por esa columna, vuelve a la página 1). La columna Acciones está justificada a la derecha.

A diferencia del resto del panel, **este filtrado NO viaja por query string**: por pedido explícito del cliente (privacidad — no quiere el texto buscado en el historial del navegador ni en logs de acceso), el `GET` de cada una siempre sirve la página con el estado por defecto (ignora cualquier query string, ni la lee ni la refleja) y todo el filtro/orden/paginación se dispara vía **HTMX** contra el `POST` del mismo path, que devuelve solo el fragmento del panel (`src/views/partials/doctores-panel.ejs` / `areas-panel.ejs`) y lo intercambia en el DOM sin recargar ni tocar la URL/historial. El estado (búsqueda/filtro/orden/página) vive en un `<form>` con inputs ocultos que cada interacción reenvía completo — no en la URL ni en la sesión del servidor. El POST lleva el mismo CSRF (`csrf-csrf`) que `POST /login`. Si la sesión expira o falta el permiso durante una interacción HTMX, el servidor responde con el header `HX-Redirect` en vez de un `302` normal, para forzar una navegación real de página completa en vez de insertar el login dentro de la tabla (`src/middlewares/hxRedirect.js`, usado por `requireAuth`/`requirePermission`, sin afectar a las demás vistas que no usan HTMX). Consecuencia aceptada: sin JavaScript habilitado estos controles no funcionan (a diferencia del resto del panel).

El orden se resuelve contra una whitelist fija de expresiones SQL en el repository de cada módulo (nunca se concatena `sort`/`dir` directo al `ORDER BY`); en doctores, "areas" ordena por el mismo `string_agg` que se muestra en la columna. Cuando el catálogo no tiene ningún registro (sin importar filtros), se oculta la barra de herramientas y se muestra un estado vacío con CTA de alta; si el catálogo tiene datos pero la búsqueda actual no encuentra nada, se mantiene la barra y solo la tabla muestra "No hay resultados para tu búsqueda".

En **doctores**, el botón "Nuevo doctor" y el ícono de editar son decorativos (`doctores.crear`/`doctores.editar`, sin funcionalidad todavía), pero **el ícono de eliminar sí funciona (US-608)**: pide confirmación vía un modal propio (no el `confirm()` nativo del navegador — patrón `htmx:confirm` + `evt.detail.issueRequest`, ver `doctores.ejs`) y ejecuta `DELETE /doctores/:id`, que hace una baja lógica (`activo=false` + `desactivado_por`/`desactivado_en`) — nunca un `DELETE` físico, para no perder el historial de citas/laboratorio que referencia al doctor. El ícono de eliminar solo aparece en filas activas.

En **áreas**, además de la baja (US-611, mismo mecanismo que doctores), **el alta y la edición también son reales (US-610)** — a diferencia de doctores, que sigue teniendo esos dos botones decorativos. Un solo formulario (`src/views/partials/area-form.ejs`) sirve para las dos acciones, en un modal propio (distinto del de confirmación): "+ Nueva área" abre el formulario vacío (`GET /areas/nuevo`); el ícono de editar lo abre precargado con el nombre y el **slug en modo solo lectura** — nunca se regenera al editar, para no romper vistas/enlaces que ya lo referencien (`GET /areas/:id/editar`). Al guardar, `POST /areas` (alta) genera el slug a partir del nombre (sin acentos, minúsculas, guiones); `PUT /areas/:id` (edición) actualiza solo el nombre (+ `actualizado_por`/`actualizado_en`).

`nombre` y `slug` siguen siendo `UNIQUE` a secas, exactamente como en `assets/sql/Omega-Database.sql` — no se tocó el schema para esta historia. "El nombre de un área dada de baja queda libre" **no** se resuelve con un índice parcial ni permitiendo dos filas con el mismo nombre: al dar de alta con un nombre que ya pertenece a un registro **inactivo**, el alta **reactiva ese mismo registro** (`activo=true`, limpia `desactivado_por`/`desactivado_en`, actualiza `actualizado_por`/`actualizado_en`) en vez de insertar una fila nueva — conserva su `id` y su `slug` originales, así que cualquier enlace viejo que lo haya referenciado sigue siendo válido. Si el nombre pertenece a un registro **activo**, se rechaza igual (AC de duplicados). Editar, en cambio, rechaza el nombre si pertenece a CUALQUIER otro registro (activo o no) — no hay "reactivar" al editar, sería fusionar la identidad de dos filas distintas, algo que la historia nunca pidió. El chequeo de duplicados es **insensible a acentos, mayúsculas y espacios** ("Neurología", "neurologia" y "Neuro Logia" cuentan como el mismo nombre) — se normaliza en JS (`areas.service.js#normalizeNombre`) comparando contra todas las áreas, no con SQL/una extensión de Postgres (el catálogo es chico y así tampoco se toca el schema). Lo que se guarda y se muestra es siempre el texto tal cual lo escribió el usuario (solo recortado), la normalización es solo para decidir si es un duplicado. Un nombre duplicado responde con el mismo fragmento del formulario más el mensaje "El nombre del Área ya esta registrada" — el modal no se cierra y no se guarda nada. Al guardar con éxito, la respuesta no reemplaza el formulario: hace un swap **out-of-band** (`hx-swap-oob`) de la tabla completa y manda el header `HX-Trigger: closeAreaModal`, que el JS del cliente traduce en cerrar el modal (ver `areas.ejs`).

**Pendiente para una migración "completa" según la bitácora de decisiones técnicas**: `index.ejs`/`main.ejs`/`agenda.ejs`/`grooming.ejs`/`laboratorio.ejs` siguen siendo mayormente el HTML/JS del PoC copiado tal cual (el sidebar ya es la excepción: se extrajo a un partial con variables reales, ver arriba), y los datos de Agenda/Laboratorio siguen siendo arreglos de ejemplo en el `<script>` de cada página. Eso se resuelve historia por historia, conforme cada módulo se conecte a datos reales de la base.

### API

- `POST /login` — `{ username, password }` → `200 { redirectTo }` | `400` (Joi) | `401` credenciales inválidas (mensaje genérico, no revela si el usuario existe) | `403` cuenta desactivada o token CSRF inválido/ausente.
- `GET /logout` — destruye la sesión, `302` a `/`.
- `GET /doctores.html` / `GET /areas.html` — página completa, siempre con el estado por defecto (ignora cualquier query string). HTML renderizado server-side (no JSON), `200`. `302` a `/main.html` si falta el permiso correspondiente (`HX-Redirect` en vez de `302` si la petición viene de HTMX).
- `POST /doctores.html` / `POST /areas.html` — fragmento HTML del panel (`q`/`estado`/`sort`/`dir`/`page` en el body, `application/x-www-form-urlencoded`), disparado por HTMX, nunca visitado directo por el usuario. Requiere CSRF (`x-csrf-token`) y el mismo permiso de lectura del módulo.
- `DELETE /doctores/:id` / `DELETE /areas/:id` — baja lógica (US-608/611), disparado por HTMX tras confirmar en el modal. HTMX manda el filtro/orden/página actual como **query string** en el `DELETE` (`methodsThatUseUrlParams` de HTMX incluye "delete", no solo "get" — gotcha real, ver `doctores.controller.js`/`areas.controller.js`), no como body. Requiere CSRF y el permiso `doctores.eliminar`/`areas.eliminar` según corresponda.
- `GET /areas/nuevo` / `GET /areas/:id/editar` (US-610) — fragmento HTML del formulario de alta/edición (vacío o precargado), swapeado dentro del modal correspondiente. Requiere `areas.crear`/`areas.editar` según corresponda.
- `POST /areas` (alta) / `PUT /areas/:id` (edición) (US-610) — `{ nombre }` en el body. Éxito: `200` con un swap out-of-band (`hx-swap-oob`) de la tabla completa + header `HX-Trigger: closeAreaModal`. Nombre vacío/duplicado (entre áreas activas): `200` con el mismo fragmento del formulario y el mensaje de error, sin `HX-Trigger` (el modal no se cierra). Requiere CSRF y `areas.crear`/`areas.editar` según corresponda.
- `GET /health` — `200 { status: "ok" }`.

El resto de endpoints reales de cada módulo (agenda, laboratorio, usuarios, etc.) se documentará conforme se implementen sus historias de usuario correspondientes.

### Scripts disponibles

| Script                       | Descripción                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `pnpm start`                 | Levanta el servidor Express en modo producción, usando `.env`                   |
| `pnpm run dev`               | Levanta el servidor con recarga automática (`node --watch`), usando `.env`      |
| `pnpm run migrate`           | Ejecuta las migraciones pendientes (`knex migrate:latest`), usando `.env`       |
| `pnpm run migrate:rollback`  | Revierte el último batch de migraciones                                         |
| `pnpm run migrate:status`    | Muestra el estado de las migraciones                                            |
| `pnpm run seed`              | Ejecuta los seeds (catálogos base + usuario admin), usando `.env`               |
| `pnpm run dev:localhost`     | Igual que `dev`, pero carga variables desde `.env.localhost` (sin tocar `.env`) |
| `pnpm run migrate:localhost` | Igual que `migrate`, cargando `.env.localhost`                                  |
| `pnpm run seed:localhost`    | Igual que `seed`, cargando `.env.localhost`                                     |
| `pnpm run lint`              | Corre ESLint sobre todo el proyecto                                             |
| `pnpm run lint:fix`          | Corre ESLint y corrige automáticamente lo que pueda                             |
| `pnpm run format`            | Formatea todo el proyecto con Prettier                                          |
| `pnpm run format:check`      | Verifica el formato sin modificar archivos (usado en CI)                        |
| `pnpm test`                  | Corre la suite de pruebas con Jest + Supertest (`tests/`)                       |

Los scripts `*:localhost` usan [`dotenv-cli`](https://github.com/entropitor/dotenv-cli) para inyectar las variables de un archivo específico sin necesidad de copiarlo a `.env` (evita el riesgo de sobrescribir por accidente un `.env` real). El mismo patrón se usará para `.env.qa` y `.env.prod` cuando existan (`dev:qa`, `start:prod`, etc.).

### Calidad y CI

- **Lint + formato**: ESLint (`eslint.config.js`, flat config, con `eslint-config-prettier` para no pelear reglas de estilo) sobre todo `src/` y `tests/`, y Prettier (`.prettierrc`) como formateador único — decisión cerrada en el documento de Arquitectura y Buenas Prácticas.
- **Tests**: Jest + Supertest, separados en `tests/unit/` (lógica de negocio mockeando el repository — `auth.service.test.js` cubre las 6 combinaciones de credenciales/estado de cuenta del login sin tocar la base de datos) y `tests/integration/` (levanta la app Express completa: `app.test.js` cubre rutas públicas/404/páginas protegidas sin sesión sin necesitar BD; `auth.test.js` corre el flujo de login de punta a punta —AC1-AC6 de US-101— contra una base de datos real, sembrada de antemano). Se ampliará por historia conforme exista más lógica de negocio que probar (Decisión 19 de la bitácora técnica).
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) corre lint + formato (`format:check`) + tests en cada push/PR a `main`, contra un contenedor de PostgreSQL efímero (migrado y sembrado con `.env.test` antes de los tests) — necesario desde que `auth.test.js` requiere una base real. Un push que no pasa alguno no debería fusionarse. Sin despliegue continuo (Decisión 20 de la bitácora — el deploy es manual vía PM2).
- **Seguridad de base**: `helmet` (cabeceras HTTP) y `compression` (gzip) activos en `src/app.js`. El _Content-Security-Policy_ de helmet está desactivado a propósito: las vistas EJS migradas del PoC usan `<script>` inline sin nonces (menú, combobox de laboratorio, semáforo de citas); se habilitará un CSP real cuando ese JS se extraiga a `public/js/`. `csrf-csrf` ya protege `POST /login` (Decisión 5 de la bitácora; `csurf` se descartó por estar deprecado). `express-rate-limit` sobre el login queda para US-106 (bloqueo por intentos fallidos) — AC4 de US-101 ya usa un mensaje de error genérico, pero el conteo/bloqueo de intentos es historia aparte.
- **Autenticación y sesiones (US-101)**: contraseñas con `bcrypt` (costo 12), comparadas con tiempo constante incluso cuando el usuario no existe (hash señuelo, evita filtrar por timing quién está registrado). Sesión con `express-session` + `connect-pg-simple` (tabla `session`, migración dedicada): expira a los 30 min de inactividad con renovación por actividad (`rolling: true`), más un tope absoluto de 10h validado aparte en `requireAuth.js` (Decisión 4 de la bitácora, corregida v4 — express-session no impone ese máximo por sí solo). El id de sesión se regenera al iniciar sesión (previene session fixation). Los permisos se resuelven una sola vez al hacer login y quedan cacheados en sesión (Decisión 5), consumidos por `requirePermission.js` y por el partial del sidebar.
- **Logging**: estructurado con Pino (`src/config/logger.js` + `pino-http` en `src/app.js`) — formato legible en desarrollo (`pino-pretty`), JSON en producción, silenciado en tests. `pino-http` está recortado a propósito para **solo loguear fallos** (4xx como `warn`, 5xx/errores como `error`); las peticiones exitosas no generan ningún log, para no gastar disco de más en el servidor de recursos limitados de la clínica. Reemplaza los `console.log` sueltos.
- **Manejo de errores**: 404 y errores no controlados centralizados en `src/middlewares/errorHandler.js`, devuelven JSON consistente en vez de la página de error por defecto de Express.
- **Apagado ordenado**: `src/server.js` cierra el servidor HTTP y el pool de PostgreSQL ante `SIGTERM`/`SIGINT` (necesario para que PM2 reinicie sin dejar conexiones colgadas), y registra `unhandledRejection`/`uncaughtException` en vez de fallar en silencio.

## Deploy

Con el frontend ya migrado a vistas EJS renderizadas por Express, el sitio dejó de ser desplegable como estático — **ya no aplica el deploy en Netlify** (no hay `index.html` en la raíz del repositorio para servir). El despliegue es siempre a través del servidor Node.js:

- Pensado para ejecutarse 24/7 vía **PM2** (`pm2 start ecosystem.config.js`) en el servidor de despliegue (servidor físico local en la clínica, Decisión 9 de la bitácora), una vez completadas las historias de infraestructura y despliegue restantes (Decisión 12).
- Exposición pública planeada vía **Cloudflare Tunnel** + dominio propio (Decisión 10 de la bitácora) — aún no configurado en este repositorio.

## Repositorios

| Repositorio            | Estado                      | Enlace                                                                               |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| **Frontend + Backend** | Este repositorio (monorepo) | [github.com/VikingKning/omega_hospvet](https://github.com/VikingKning/omega_hospvet) |
