<p align="center">
  <img src="assets/imgs/icon.png" alt="Omega Veterinaria & Estética" width="120">
</p>

<h1 align="center">Omega Veterinaria & Estética — Panel Administrativo</h1>

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS3-2E5090?style=flat&logo=css3&logoColor=white" alt="CSS3">
  <img src="https://img.shields.io/badge/JavaScript-F2A900?style=flat&logo=javascript&logoColor=white" alt="JavaScript">
  <img src="https://img.shields.io/badge/Hosting-Netlify-1E8E3E?style=flat&logo=netlify&logoColor=white" alt="Netlify">
  <img src="https://img.shields.io/badge/status-en%20desarrollo-F00F35?style=flat" alt="En desarrollo">
</p>

---

## Tabla de contenido

- [Descripción](#descripción)
- [Prerequisitos para ejecución](#prerequisitos-para-ejecución)
- [Instalación](#instalación)
- [Arquitectura](#arquitectura)
  - [Configuración de entorno](#configuración-de-entorno)
  - [Stack tecnológico](#stack-tecnológico)
  - [Estructura del proyecto](#estructura-del-proyecto)
  - [Rutas](#rutas)
  - [API](#api)
  - [Scripts disponibles](#scripts-disponibles)
- [Entornos de Build](#entornos-de-build)
- [Comandos de desarrollo](#comandos-de-desarrollo)
- [Deploy](#deploy)
- [Repositorios](#repositorios)

---

## Descripción

Panel administrativo para **Omega Veterinaria & Estética**: una interfaz web para el personal de la clínica que cubre inicio de sesión, un dashboard principal con menú lateral colapsable, un módulo de **Agenda** (Consultas y Cirugías, Grooming) con calendario de Google embebido y semáforo de puntualidad de citas, y un módulo de **Laboratorio** con alta de órdenes multi-estudio (catálogo por categoría/estudio/zona anatómica), filtros de búsqueda y carga simulada de resultados.

Es un sitio **100% estático** (HTML + CSS + JavaScript vanilla), sin frameworks ni proceso de build, pensado para desplegarse directamente en un hosting estático.

## Prerequisitos para ejecución

- Un navegador moderno (Chrome, Edge, Firefox).
- [Git](https://git-scm.com/) para clonar el repositorio.
- *(Opcional, recomendado)* Un servidor local simple para servir los archivos por `http://` en vez de `file://` — algunas integraciones (como el iframe de Google Calendar) se comportan mejor servidas por HTTP.

No se requiere Node.js, npm ni ningún gestor de paquetes: el proyecto no tiene dependencias.

## Instalación

```bash
git clone https://github.com/VikingKning/omega_hospvet.git
cd omega_hospvet
```

No hay paso de instalación de dependencias — el proyecto no usa `package.json`. Con clonar el repositorio es suficiente para empezar a trabajar.

## Arquitectura

### Configuración de entorno

El proyecto no usa variables de entorno ni archivos `.env`. El único punto de configuración manual es el **ID del calendario de Google** que se embebe en `agenda.html` y `grooming.html`:

```
src="https://calendar.google.com/calendar/embed?src=CALENDAR_ID%40group.calendar.google.com&..."
```

Debe reemplazarse `CALENDAR_ID` por el ID real de cada calendario (Google Calendar → Configuración → Integrar calendario), y ese calendario debe estar compartido públicamente para que el embed funcione sin iniciar sesión.

### Stack tecnológico

| Tecnología | Uso |
|---|---|
| HTML5 | Marcado semántico de cada página |
| CSS3 (vanilla) | Sistema de diseño propio, sin frameworks (`styles.css` + `main.css`) |
| JavaScript (ES6+) | Interactividad: menú, filtros, modales, semáforo, combobox de búsqueda |
| Google Calendar Embed | Visualización de citas en Agenda/Grooming |
| Netlify | Hosting y despliegue continuo |

### Estructura del proyecto

```
OmegaVet_AdminSite/
├── index.html          # Redirección automática a login.html
├── login.html           # Pantalla de inicio de sesión
├── main.html            # Dashboard / panel administrativo
├── agenda.html           # Agenda → Consultas y Cirugías
├── grooming.html         # Agenda → Grooming
├── laboratorio.html      # Módulo de Laboratorio
├── styles.css            # Paleta de colores base + estilos de login
├── main.css              # Estilos del app shell (sidebar, topbar, tablas, modales)
└── assets/
    └── imgs/             # Logotipos e íconos de la marca
```

### Rutas

| Ruta | Descripción |
|---|---|
| `/index.html` | Redirige automáticamente a `login.html` |
| `/login.html` | Inicio de sesión |
| `/main.html` | Panel administrativo (landing tras iniciar sesión) |
| `/agenda.html` | Agenda de Consultas y Cirugías (calendario + estadísticas del día) |
| `/grooming.html` | Agenda de Grooming (calendario + estadísticas del día) |
| `/laboratorio.html` | Órdenes de laboratorio, filtros y alta de estudios |

### API

_Vacía por el momento._ El frontend aún no está conectado a un backend real: los datos de Laboratorio y las estadísticas de Agenda son datos de ejemplo en memoria (arreglos de JavaScript dentro de cada página). Esta sección se documentará cuando exista un backend con endpoints reales.

### Scripts disponibles

El proyecto no tiene `package.json` ni herramientas de build, por lo que **no hay scripts npm configurados** actualmente. Cada página es autocontenida y se ejecuta abriéndola directamente o sirviéndola como archivo estático.

## Entornos de Build

No existe un paso de compilación/transpilación: los archivos `.html`, `.css` y `.js` se sirven tal cual. El "build" de producción es idéntico al código fuente del repositorio.

## Comandos de desarrollo

Cualquiera de estas opciones sirve para levantar el sitio en local:

```bash
# Opción 1: extensión Live Server de VS Code
# clic derecho en index.html → "Open with Live Server"

# Opción 2: servidor HTTP simple con Python
python -m http.server 5500

# Opción 3: paquete serve de Node (si tienes Node instalado)
npx serve .
```

Luego abre `http://localhost:5500` (o el puerto que corresponda) en el navegador.

## Deploy

El sitio se despliega en **Netlify** como sitio estático:

- Cada push a la rama principal dispara un deploy automático.
- Al no requerir build, la configuración de Netlify apunta directamente a la raíz del repositorio como *publish directory*.
- Alternativamente, puede desplegarse arrastrando la carpeta del proyecto a Netlify Drop para una publicación manual.

## Repositorios

| Repositorio | Estado | Enlace |
|---|---|---|
| **Frontend** | Este repositorio | [github.com/VikingKning/omega_hospvet](https://github.com/VikingKning/omega_hospvet) |
| **Backend** | Pendiente de desarrollo | — |
