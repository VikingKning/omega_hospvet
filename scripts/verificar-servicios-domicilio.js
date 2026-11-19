// Solo lectura: no envia mensajes ni crea, modifica o cancela citas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../src/config/env');
const db = require('../src/config/database');
const { getCalendarClient, isGoogleSyncConfigured } = require('../src/config/googleCalendar');
const menu = require('../src/modules/whatsapp/whatsapp.menu');
const whatsappAgenda = require('../src/config/whatsappAgenda');

async function main() {
  const raiz = path.resolve(__dirname, '..');
  const rutas = [
    'src/config/whatsappAgenda.js',
    'src/modules/whatsapp/whatsapp.menu.js',
    'src/views/partials/configuracion-generales-form.ejs',
    'src/modules/agenda/agenda.reservasExternas.js',
  ];
  const archivos = rutas.map((ruta) => {
    const contenido = fs.readFileSync(path.join(raiz, ruta));
    return {
      ruta,
      sha256: crypto.createHash('sha256').update(contenido).digest('hex'),
      contiene_nombre_nuevo: contenido.toString('utf8').includes('Servicios a Domicilio'),
    };
  });
  const base = await db.raw('select current_database() as nombre');
  const areas = await db('areas')
    .where({ slug: 'consultas' })
    .select('id', 'nombre', 'slug', 'activo');
  const migraciones = await db('knex_migrations')
    .where('name', 'like', '20261118%')
    .orderBy('name')
    .select('name', 'migration_time');
  const funcion = await db('configuracion_funciones')
    .where({ clave: 'whatsapp_citas_consultas' })
    .first('clave', 'nombre', 'habilitado');
  const filaMenu = menu.filasDisponibles().find((fila) => fila.id === menu.MENU_AGENDAR_CONSULTA);
  const reporte = {
    generado_en: new Date().toISOString(),
    proyecto_consultado: raiz,
    base_de_datos: base.rows[0].nombre,
    archivos_en_disco: archivos,
    titulo_menu_en_disco: filaMenu?.title,
    tipo_cita_en_disco: whatsappAgenda.obtenerConfiguracionRuta('agendar_consulta').tipoCita,
    areas,
    funcion,
    migraciones,
    enlace_reservas_en_env: env.enlaces.calendarioCitas || null,
    calendario_destino_en_env: env.google.calendarId || null,
    calendario_destino_google: null,
    nota: 'Este diagnostico lee el proyecto indicado y su entorno; no demuestra por si solo que el servicio este ejecutando esta misma carpeta.',
  };
  if (isGoogleSyncConfigured()) {
    try {
      const { data } = await getCalendarClient().calendars.get(
        { calendarId: env.google.calendarId },
        { timeout: 15000 },
      );
      reporte.calendario_destino_google = {
        id: data.id,
        nombre: data.summary,
        zona_horaria: data.timeZone,
      };
    } catch (err) {
      reporte.calendario_destino_google = {
        error: 'No se pudo consultar el calendario configurado.',
        codigo: err.response?.status ?? err.code ?? null,
      };
    }
  }
  console.log(JSON.stringify(reporte, null, 2));
}

main()
  .catch(() => {
    console.error(
      'No se pudo completar el diagnostico. Revisar la conexion a la base de datos y los archivos instalados.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
