const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../../config/database');
const repository = require('./configuracion.repository');

class ConfiguracionValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const CLAVE_ARCHIVO = 'aviso_privacidad_archivo';
const CLAVE_VERSION = 'aviso_privacidad_version';
const CLAVE_NOMBRE_ORIGINAL = 'aviso_privacidad_nombre';
const CLAVES_AVISO = [CLAVE_ARCHIVO, CLAVE_VERSION, CLAVE_NOMBRE_ORIGINAL];

// Cada carga es una versión nueva, nunca reemplaza el archivo anterior en
// disco: un tutor pudo haber aceptado una versión vieja del aviso, y esa
// evidencia (consentimiento_lfpdppp.version_aviso) solo es verificable si
// el PDF que estaba vigente en ese momento sigue existiendo. Las claves de
// configuracion_sistema siempre apuntan a la versión VIGENTE (la última
// subida); el historial completo vive en aviso_privacidad_versiones.
const DIRECTORIO_LEGAL = path.join(__dirname, '../../../public/legal');
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const CANTIDAD_VERSIONES_MOSTRADAS = 5;

async function obtenerAvisoPrivacidad() {
  const [archivo, version, nombreOriginal] = await repository.obtenerValores(CLAVES_AVISO);
  return {
    archivo: archivo?.valor ?? null,
    version: version?.valor ?? null,
    nombreOriginal: nombreOriginal?.valor ?? null,
    actualizadoEn: archivo?.actualizado_en ?? null,
  };
}

async function listarUltimasVersionesAviso() {
  return repository.listarUltimasVersionesAviso(CANTIDAD_VERSIONES_MOSTRADAS);
}

async function guardarAvisoPrivacidad({ buffer, nombreOriginal, mimeType, version, usuarioId }) {
  if (mimeType !== 'application/pdf') {
    throw new ConfiguracionValidationError('El aviso de privacidad debe ser un archivo PDF.');
  }
  if (!buffer || buffer.length === 0) {
    throw new ConfiguracionValidationError('El archivo está vacío.');
  }
  if (buffer.length > TAMANO_MAXIMO_BYTES) {
    throw new ConfiguracionValidationError('El archivo es demasiado grande (máximo 10MB).');
  }

  const nombreArchivo = `aviso-privacidad-${crypto.randomUUID()}.pdf`;
  await fs.mkdir(DIRECTORIO_LEGAL, { recursive: true });
  await fs.writeFile(path.join(DIRECTORIO_LEGAL, nombreArchivo), buffer);

  const versionFinal = version?.trim() || new Date().toISOString().slice(0, 10);
  await db.transaction(async (trx) => {
    await repository.insertarVersionAviso(
      { version: versionFinal, nombreArchivo, nombreOriginal, usuarioId },
      trx,
    );
    await repository.guardarValores(
      [
        {
          clave: CLAVE_ARCHIVO,
          valor: nombreArchivo,
          descripcion: 'Nombre del archivo (dentro de public/legal) de la versión vigente',
        },
        {
          clave: CLAVE_VERSION,
          valor: versionFinal,
          descripcion: 'Versión vigente del aviso de privacidad (LFPDPPP)',
        },
        {
          clave: CLAVE_NOMBRE_ORIGINAL,
          valor: nombreOriginal,
          descripcion: 'Nombre original del archivo cargado por el administrador',
        },
      ],
      usuarioId,
      trx,
    );
  });

  return obtenerAvisoPrivacidad();
}

// Usado por whatsapp.consentimiento.service.js. Sin archivo cargado, el
// gate de consentimiento se mantiene apagado (mismo criterio que otras
// integraciones opcionales del proyecto). A diferencia del diseño anterior,
// esto ya NO depende de ninguna URL pública: el PDF se sube directo a Meta
// (mismo mecanismo que laboratorio, ver whatsapp.envios.js#subirMedia) en
// vez de que Meta lo descargue de un link — evita el túnel/dominio público
// que solo hacía falta para esta única funcionalidad.
async function obtenerVersionVigenteParaEnvio() {
  const { archivo, version, nombreOriginal } = await obtenerAvisoPrivacidad();
  if (!archivo) return null;
  return { archivo, version, nombreArchivo: nombreOriginal || archivo };
}

async function leerArchivoAviso(nombreArchivo) {
  return fs.readFile(path.join(DIRECTORIO_LEGAL, nombreArchivo));
}

module.exports = {
  ConfiguracionValidationError,
  obtenerAvisoPrivacidad,
  guardarAvisoPrivacidad,
  obtenerVersionVigenteParaEnvio,
  leerArchivoAviso,
  listarUltimasVersionesAviso,
};
