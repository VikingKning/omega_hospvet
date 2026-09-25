const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../../config/database');
const repository = require('./configuracion.repository');
// Mismo conversor Word→PDF que laboratorio (LibreOffice headless) — pedido
// explícito del usuario en vez de duplicar la lógica de conversión aquí.
// Sin destructurar: así los tests pueden mockear
// laboratorioArchivos.convertirWordAPdf sin tocar LibreOffice de verdad.
const laboratorioArchivos = require('../laboratorio/laboratorio.archivos');
const { CLAVES_FUNCIONES, LISTA_CLAVES_FUNCIONES } = require('./configuracion-funciones');

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

const TIPOS_WORD = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const TIPOS_PERMITIDOS = new Set(['application/pdf', ...TIPOS_WORD]);

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

function calcularVersionPorDefecto() {
  return `v.${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
}

function construirValoresAviso({ nombreArchivo, versionFinal, nombreOriginal }) {
  return [
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
  ];
}

// Usado por el front antes de enviar el formulario, para decidir si debe
// mostrar el modal de "este archivo ya existe" (pedido explícito del
// usuario) sin obligarlo a escanear las 5 filas visibles del historial. El
// match es por nombre+contenido, no por versión — a un mismo PDF se le
// puede poner una etiqueta de versión distinta cada vez.
async function existeArchivoAviso({ nombreOriginal, hash }) {
  const fila = await repository.obtenerVersionPorNombreYHash(nombreOriginal, hash);
  return { existe: Boolean(fila) };
}

async function guardarAvisoPrivacidad({
  buffer,
  nombreOriginal,
  mimeType,
  version,
  reenviar,
  usuarioId,
}) {
  if (!TIPOS_PERMITIDOS.has(mimeType)) {
    throw new ConfiguracionValidationError(
      'El aviso de privacidad debe ser un PDF o un documento de Word (.doc/.docx).',
    );
  }
  if (!buffer || buffer.length === 0) {
    throw new ConfiguracionValidationError('El archivo está vacío.');
  }
  if (buffer.length > TAMANO_MAXIMO_BYTES) {
    throw new ConfiguracionValidationError('El archivo es demasiado grande (máximo 10MB).');
  }

  const versionFinal = version?.trim() || calcularVersionPorDefecto();
  // Se hashea el archivo tal cual se subió (antes de convertir un .doc/.docx
  // a PDF): así una misma carga se reconoce como igual sin depender de que
  // LibreOffice produzca bytes idénticos entre una conversión y otra.
  const hashContenido = laboratorioArchivos.calcularHash(buffer);

  // Mismo nombre + mismo contenido = el mismo archivo, sin importar qué
  // versión se le haya puesto cada vez (pedido explícito del usuario, tras
  // ver que re-subir el mismo PDF con una versión distinta cada vez seguía
  // duplicando el archivo en disco).
  const coincidencia = await repository.obtenerVersionPorNombreYHash(nombreOriginal, hashContenido);
  if (coincidencia) {
    await db.transaction(async (trx) => {
      if (coincidencia.version === versionFinal) {
        await repository.reactivarVersion(coincidencia.id, usuarioId, Boolean(reenviar), trx);
      } else {
        await repository.insertarVersionAviso(
          {
            version: versionFinal,
            nombreArchivo: coincidencia.nombre_archivo,
            nombreOriginal,
            hashContenido,
            requiereReconsentimiento: reenviar,
            usuarioId,
          },
          trx,
        );
      }
      await repository.guardarValores(
        construirValoresAviso({
          nombreArchivo: coincidencia.nombre_archivo,
          versionFinal,
          nombreOriginal,
        }),
        usuarioId,
        trx,
      );
    });
    return obtenerAvisoPrivacidad();
  }

  const colisionVersion = await repository.obtenerVersionPorVersion(versionFinal);
  if (colisionVersion) {
    throw new ConfiguracionValidationError(
      `Ya existe la versión "${versionFinal}" registrada para un archivo distinto. Usa un identificador de versión diferente.`,
    );
  }

  // Meta y el gate de consentimiento siempre trabajan sobre un PDF real —
  // un .doc/.docx se convierte aquí mismo, una sola vez, al guardar.
  const bufferPdf = TIPOS_WORD.has(mimeType)
    ? await laboratorioArchivos.convertirWordAPdf(buffer, nombreOriginal)
    : buffer;

  const nombreArchivo = `aviso-privacidad-${crypto.randomUUID()}.pdf`;
  await fs.mkdir(DIRECTORIO_LEGAL, { recursive: true });
  await fs.writeFile(path.join(DIRECTORIO_LEGAL, nombreArchivo), bufferPdf);

  await db.transaction(async (trx) => {
    await repository.insertarVersionAviso(
      {
        version: versionFinal,
        nombreArchivo,
        nombreOriginal,
        hashContenido,
        requiereReconsentimiento: reenviar,
        usuarioId,
      },
      trx,
    );
    await repository.guardarValores(
      construirValoresAviso({ nombreArchivo, versionFinal, nombreOriginal }),
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
// que solo hacía falta para esta única funcionalidad. Incluye el media_id
// cacheado (si ya se subió antes) para que el llamador no vuelva a subir el
// mismo PDF en cada solicitud de consentimiento nueva.
async function obtenerVersionVigenteParaEnvio() {
  const { archivo, version, nombreOriginal } = await obtenerAvisoPrivacidad();
  if (!archivo) return null;
  // Por versión, NUNCA por nombre_archivo: desde que varias filas pueden
  // compartir el mismo archivo físico (reutilización por contenido, ver
  // migración 20260919000009), buscar solo por nombre_archivo es ambiguo y
  // puede devolver una fila vieja con requiere_reconsentimiento/media_id
  // equivocados — bug real visto en vivo 2026-09-21. `version` sigue
  // siendo única (migración 20260919000007).
  const fila = await repository.obtenerVersionPorVersion(version);
  return {
    versionId: fila?.id ?? null,
    mediaId: fila?.media_id ?? null,
    archivo,
    version,
    nombreArchivo: nombreOriginal || archivo,
    requiereReconsentimiento: fila?.requiere_reconsentimiento ?? false,
  };
}

async function actualizarMediaIdVersion(versionId, mediaId) {
  if (!versionId) return;
  await repository.actualizarMediaId(versionId, mediaId);
}

async function leerArchivoAviso(nombreArchivo) {
  return fs.readFile(path.join(DIRECTORIO_LEGAL, nombreArchivo));
}

async function obtenerFunciones() {
  const filas = await repository.listarFunciones();
  return Object.fromEntries(filas.map((fila) => [fila.clave, Boolean(fila.habilitado)]));
}

async function actualizarFuncion({ clave, habilitado, usuarioId }) {
  if (!LISTA_CLAVES_FUNCIONES.includes(clave)) {
    throw new ConfiguracionValidationError('La función indicada no existe.');
  }
  if (typeof habilitado !== 'boolean') {
    throw new ConfiguracionValidationError('El valor de la función debe ser verdadero o falso.');
  }

  const funcion = await repository.actualizarFuncion(clave, habilitado, usuarioId);
  if (!funcion) {
    throw new ConfiguracionValidationError('La función indicada no está configurada.');
  }
  return { clave: funcion.clave, habilitado: Boolean(funcion.habilitado) };
}

async function obtenerConfiguracionEnvioLaboratorio() {
  const funciones = await obtenerFunciones();
  const whatsapp = funciones[CLAVES_FUNCIONES.LABORATORIO_ENVIO_WHATSAPP] === true;
  const correo = funciones[CLAVES_FUNCIONES.LABORATORIO_ENVIO_CORREO] === true;
  return { whatsapp, correo, habilitado: whatsapp || correo };
}

async function obtenerConfiguracionWhatsapp() {
  const funciones = await obtenerFunciones();
  return {
    respuestasAutomaticas: funciones[CLAVES_FUNCIONES.WHATSAPP_RESPUESTAS_AUTOMATICAS] === true,
    citasConsultas: funciones[CLAVES_FUNCIONES.WHATSAPP_CITAS_CONSULTAS] === true,
    citasEstetica: funciones[CLAVES_FUNCIONES.WHATSAPP_CITAS_ESTETICA] === true,
    avisoPrivacidad: funciones[CLAVES_FUNCIONES.WHATSAPP_AVISO_PRIVACIDAD] === true,
  };
}

module.exports = {
  ConfiguracionValidationError,
  obtenerAvisoPrivacidad,
  existeArchivoAviso,
  guardarAvisoPrivacidad,
  obtenerVersionVigenteParaEnvio,
  actualizarMediaIdVersion,
  leerArchivoAviso,
  listarUltimasVersionesAviso,
  obtenerFunciones,
  actualizarFuncion,
  obtenerConfiguracionEnvioLaboratorio,
  obtenerConfiguracionWhatsapp,
  CLAVES_FUNCIONES,
};
