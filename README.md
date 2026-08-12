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

Panel administrativo para **Omega Veterinaria & Estética**: una interfaz web para el personal de la clínica que cubre inicio de sesión, un dashboard principal con menú lateral colapsable, un módulo de **Agenda** (Consultas y Cirugías, Grooming) con calendario de Google embebido y semáforo de puntualidad de citas, y un módulo de **Laboratorio** con alta de órdenes multi-estudio (catálogo por categoría/estudio/zona anatómica), filtros de búsqueda y carga simulada de resultados.

El frontend (HTML + CSS + JavaScript vanilla, sin frameworks de cliente ni proceso de build) se renderiza server-side con Express + EJS, sobre el backend (Node.js + Express + PostgreSQL vía Knex) que se está construyendo por historias de usuario a partir de la Fase 0 de infraestructura (US-000). El HTML/JS/CSS de cada página no cambió respecto al PoC original — solo cambió quién lo sirve.

## Prerequisitos para ejecución

- [Node.js](https://nodejs.org/) 22.13+ (requerido por pnpm 11) y [pnpm](https://pnpm.io/) (gestor de paquetes decidido en la bitácora técnica; `npm install -g pnpm` o `corepack enable` si tu instalación de Node lo soporta).
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

Esto crea las 20 tablas del Modelo de Datos v4 más sus foreign keys, y siembra `permissions` (29 permisos), los catálogos de laboratorio (categorías/estudios/zonas anatómicas) y el usuario administrador de arranque con `ADMIN_USERNAME`/`ADMIN_PASSWORD` del archivo de entorno usado.

### 6. Levantar el servidor

```bash
pnpm run dev:localhost   # o: pnpm run dev, si usas .env
```

Deberías ver en consola: `Omega Vet AdminSite escuchando en el puerto 3000 (development)`. Para detenerlo, `Ctrl+C` en esa misma terminal.

### 7. Probar en el navegador

- `http://localhost:3000/` → debe cargar la pantalla de inicio de sesión (`index.html`, servida por Express).
- `http://localhost:3000/health` → debe responder `{"status":"ok"}`.
- El formulario de login todavía solo valida en el cliente (no hay autenticación real conectada al backend): cualquier usuario/contraseña no vacíos te llevan a `main.html`. Desde ahí puedes navegar todo el panel (`agenda.html`, `grooming.html`, `laboratorio.html`) — las 5 páginas ya se sirven vía Express (ver [Rutas](#rutas)).
- Para confirmar que el seed del admin quedó bien, puedes consultarlo directo en la base: `psql -U omega_hospvet -d omega_hospvet -c "select username, correo from usuarios;"` (ajusta usuario/base a los de tu `.env.localhost`).

## Arquitectura

### Configuración de entorno

Las credenciales y configuración sensible viven en `.env` (excluido de control de versiones). `.env.example` documenta las variables requeridas: conexión a PostgreSQL, `SESSION_SECRET` y los datos del usuario administrador de arranque (`ADMIN_*`, consumidos por el seed `05_admin_usuario.js`).

Además, el **ID del calendario de Google** se embebe manualmente en `src/views/agenda.ejs` y `src/views/grooming.ejs`:

```
src="https://calendar.google.com/calendar/embed?src=CALENDAR_ID%40group.calendar.google.com&..."
```

Debe reemplazarse `CALENDAR_ID` por el ID real de cada calendario (Google Calendar → Configuración → Integrar calendario), y ese calendario debe estar compartido públicamente para que el embed funcione sin iniciar sesión.

### Stack tecnológico

| Tecnología            | Uso                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js + Express     | Servidor de la aplicación web                                                                                                           |
| EJS                   | Motor de vistas server-side (`src/views/*.ejs`)                                                                                         |
| CSS3 (vanilla)        | Sistema de diseño propio, sin frameworks (`public/css/styles.css` + `public/css/main.css`)                                              |
| JavaScript (ES6+)     | Interactividad de cliente: menú, filtros, modales, semáforo, combobox de búsqueda (embebido en cada vista, sin cambios respecto al PoC) |
| PostgreSQL + Knex     | Base de datos y migraciones/seeds versionados                                                                                           |
| PM2                   | Gestión del proceso en producción (`ecosystem.config.js`)                                                                               |
| Google Calendar Embed | Visualización de citas en Agenda/Grooming                                                                                               |

### Estructura del proyecto

```
OmegaVet_AdminSite/
├── .github/workflows/ci.yml                       # GitHub Actions: lint + tests en cada push/PR
├── assets/
│   └── sql/                                       # Omega-Database.sql, modelo DBML y ERD (fuente del esquema, NO se sirve públicamente)
├── public/                                        # Estáticos servidos por Express (express.static)
│   ├── css/                                       # styles.css, main.css
│   ├── js/                                        # (pendiente: JS de cada vista aún vive inline en el .ejs, no aquí)
│   └── assets/imgs/                               # Logotipos e íconos de la marca
├── src/
│   ├── config/                                    # env.js, database.js (Knex), logger.js (Pino)
│   ├── db/
│   │   ├── migrations/                            # Una migración por tabla + FKs
│   │   ├── seeds/                                 # Catálogos base y usuario admin de arranque
│   │   └── knexfile.js                            # Config real de Knex (migrations/seeds relativas a esta carpeta)
│   ├── middlewares/                                # errorHandler.js (404 + errores centralizados)
│   ├── modules/                                    # auth, agenda, grooming, laboratorio, usuarios, ...
│   ├── views/                                       # index.ejs, main.ejs, agenda.ejs, grooming.ejs, laboratorio.ejs
│   ├── app.js                                      # App Express (view engine EJS, helmet, compression, logging, rutas)
│   └── server.js                                   # Punto de entrada (graceful shutdown)
├── tests/
│   ├── unit/                                       # Jest — lógica de negocio (aún vacío: no hay services/repositories todavía)
│   └── integration/app.test.js                     # Jest + Supertest — app Express completa
├── eslint.config.js
├── .prettierrc, .prettierignore
├── jest.config.js
├── .editorconfig
├── knexfile.js                                     # Re-export delgado de src/db/knexfile.js (para `knex` sin --knexfile)
├── ecosystem.config.js                             # Configuración de PM2
└── .env.example
```

### Rutas

| Ruta                | Vista renderizada           | Descripción                                                        |
| ------------------- | --------------------------- | ------------------------------------------------------------------ |
| `/` y `/index.html` | `src/views/index.ejs`       | Inicio de sesión (antes `login.html`; ahora es la página raíz)     |
| `/main.html`        | `src/views/main.ejs`        | Panel administrativo (landing tras iniciar sesión)                 |
| `/agenda.html`      | `src/views/agenda.ejs`      | Agenda de Consultas y Cirugías (calendario + estadísticas del día) |
| `/grooming.html`    | `src/views/grooming.ejs`    | Agenda de Grooming (calendario + estadísticas del día)             |
| `/laboratorio.html` | `src/views/laboratorio.ejs` | Órdenes de laboratorio, filtros y alta de estudios                 |
| `/health`           | —                           | Health check del servidor Express                                  |

Las 5 páginas del panel ya se sirven completamente vía Express con `res.render()` (motor EJS); ya no existen archivos `.html` sueltos en la raíz del repositorio. Las URLs conservan la extensión `.html` a propósito, para no romper los enlaces del sidebar/navegación ya escritos en cada vista. `public/` (vía `express.static`) sirve `styles.css`, `main.css` y `assets/imgs/*`; `assets/sql/` (el esquema de la base de datos) nunca se expone.

**Pendiente para una migración "completa" según la bitácora de decisiones técnicas**: hoy las vistas son el mismo HTML/JS del PoC copiado tal cual a `.ejs` (sin usar variables ni partials de EJS todavía) y los datos de Agenda/Laboratorio siguen siendo arreglos de ejemplo en el `<script>` de cada página. Eso se resuelve historia por historia, conforme cada módulo se conecte a datos reales de la base.

### API

_En construcción._ Por ahora el servidor Express solo expone `/health` y sirve estáticos. Los endpoints reales de cada módulo (agenda, laboratorio, usuarios, etc.) se documentarán conforme se implementen sus historias de usuario correspondientes.

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
- **Tests**: Jest + Supertest, separados en `tests/unit/` (lógica de negocio mockeando el repository — aún vacío, no existen `services`/`repositories` todavía) y `tests/integration/app.test.js` (levanta la app Express completa: smoke tests de las 5 rutas del panel, `/health`, manejo de 404 y que `assets/sql/` nunca se exponga). Se ampliará por historia conforme exista lógica de negocio real que probar (Decisión 19 de la bitácora técnica).
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) corre lint + formato (`format:check`) + tests en cada push/PR a `main`; un push que no pasa alguno no debería fusionarse. Sin despliegue continuo (Decisión 20 de la bitácora — el deploy es manual vía PM2).
- **Seguridad de base**: `helmet` (cabeceras HTTP) y `compression` (gzip) activos en `src/app.js`. El _Content-Security-Policy_ de helmet está desactivado a propósito: las vistas EJS migradas del PoC usan `<script>` inline sin nonces (menú, combobox de laboratorio, semáforo de citas); se habilitará un CSP real cuando ese JS se extraiga a `public/js/`. `express-rate-limit` y `csrf-csrf` (Decisión 5 de la bitácora) se agregarán cuando exista un endpoint de login real que proteger.
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
