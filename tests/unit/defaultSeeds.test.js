const { AGENDA_CATEGORIAS, PERMISSIONS } = require('../../src/db/seeds/01_permissions');
const { ZONAS } = require('../../src/db/seeds/02_catalogo_zonas_anatomicas');
const { CATEGORIAS } = require('../../src/db/seeds/03_catalogo_categorias_estudio');
const {
  ESTUDIOS_NO_CANONICOS,
  construirFilas,
} = require('../../src/db/seeds/04_catalogo_estudios');
const { CONFIGURACION } = require('../../src/db/seeds/04_catalogo_zonas_por_estudio');
const { AREAS_AGENDA } = require('../../src/db/seeds/06_areas_agenda');
const { DOCTORES_PREDETERMINADOS } = require('../../src/db/seeds/07_doctores_predeterminados');
const { FUNCIONES_SISTEMA } = require('../../src/db/seeds/08_configuracion_funciones');

describe('datos predeterminados para una instalación limpia', () => {
  it('solo define Consultas y Estética como áreas iniciales', () => {
    expect(AREAS_AGENDA).toEqual([
      ['Consultas', 'consultas'],
      ['Estética', 'estetica'],
    ]);
    expect(AGENDA_CATEGORIAS).toEqual([
      ['agenda_consultas', 'consultas', 'Consultas'],
      ['agenda_estetica', 'estetica', 'Estética'],
    ]);
    expect(PERMISSIONS.some(([modulo]) => ['agenda', 'grooming'].includes(modulo))).toBe(false);
  });

  it('define los doctores técnicos de las dos reservas externas', () => {
    expect(DOCTORES_PREDETERMINADOS).toEqual([
      { nombre: 'Consultas Omega', apellidos: 'Generico', areaSlug: 'consultas' },
      { nombre: 'Estética Omega', apellidos: 'Generico', areaSlug: 'estetica' },
    ]);
  });

  it('define las seis funciones configurables con claves estables', () => {
    expect(FUNCIONES_SISTEMA.map(({ clave }) => clave)).toEqual([
      'laboratorio_envio_whatsapp',
      'laboratorio_envio_correo',
      'whatsapp_respuestas_automaticas',
      'whatsapp_citas_consultas',
      'whatsapp_citas_estetica',
      'whatsapp_aviso_privacidad',
    ]);
    expect(new Set(FUNCIONES_SISTEMA.map(({ clave }) => clave)).size).toBe(6);
  });

  it('mantiene categorías y zonas sin nombres o códigos duplicados', () => {
    expect(CATEGORIAS).toHaveLength(33);
    expect(new Set(CATEGORIAS).size).toBe(CATEGORIAS.length);

    const codigosZona = ZONAS.map(([codigo]) => codigo);
    const nombresZona = ZONAS.map(([, nombre]) => nombre);
    expect(ZONAS).toHaveLength(13);
    expect(new Set(codigosZona).size).toBe(ZONAS.length);
    expect(new Set(nombresZona).size).toBe(ZONAS.length);
  });

  it('construye el catálogo canónico de estudios con códigos estables y válidos', () => {
    const categoriaIdPorNombre = Object.fromEntries(
      CATEGORIAS.map((categoria, index) => [categoria, index + 1]),
    );
    const filas = construirFilas(categoriaIdPorNombre);

    expect(filas).toHaveLength(747);
    expect(new Set(filas.map(({ codigo }) => codigo)).size).toBe(filas.length);
    expect(filas.every(({ codigo }) => codigo.length <= 50)).toBe(true);
    expect(filas.every(({ activo }) => activo === true)).toBe(true);

    const categoriaNombrePorId = Object.fromEntries(
      CATEGORIAS.map((categoria, index) => [index + 1, categoria]),
    );
    const claves = new Set(
      filas.map(({ categoria_id: categoriaId, nombre }) => {
        return `${categoriaNombrePorId[categoriaId]}::${nombre}`;
      }),
    );
    for (const claveNoCanonica of ESTUDIOS_NO_CANONICOS) {
      expect(claves.has(claveNoCanonica)).toBe(false);
    }

    expect(
      filas.find(({ nombre, especie }) => nombre === 'Uroanálisis completo' && especie === 'Gato')
        ?.codigo,
    ).toBe('GATO_UROANALISIS_CISTOCENTESIS');
    expect(filas.find(({ nombre }) => nombre === 'Ultrasonido')?.codigo).toBe(
      'IMAGENOLOGIA_ULTRASONIDO',
    );

    const codigosPublicadosConSufijo = [
      'FIBRINOGENO_2',
      'CORTISOL_CREATININA_URINARIA_2',
      'GIARDIA_PCR_2',
      'CRYPTOSPORIDIUM_PCR_2',
      'CITOLOGIA_CUTANEA_2',
      'CITOLOGIA_OTICA_2',
      'RADIOGRAFIA_TORACICA_2',
      'ULTRASONIDO_OCULAR_2',
      'ANTICUERPOS_CONTRA_RECEPTOR_DE_ACETILCOLINA_2',
      'PANEL_DE_DONADOR_SANGUINEO_CANINO_2',
      'PANEL_DE_DONADOR_SANGUINEO_FELINO_2',
      'ANALISIS_DE_LIQUIDO_SINOVIAL_2',
      'ANALISIS_DE_LIQUIDO_CEFALORRAQUIDEO_2',
      'PANEL_RESPIRATORIO_CANINO_2',
      'PANEL_RESPIRATORIO_FELINO_2',
      'GASTROSCOPIA_2',
      'COLONOSCOPIA_2',
      'RINOSCOPIA_2',
      'BRONCOSCOPIA_2',
      'OTOSCOPIA_2',
      'VIDEOOTOSCOPIA_2',
      'ARTROSCOPIA_2',
      'BIOPSIA_DE_MEDULA_OSEA_2',
      'ARTROCENTESIS_2',
    ];
    expect(filas.map(({ codigo }) => codigo)).toEqual(
      expect.arrayContaining(codigosPublicadosConSufijo),
    );

    const perfilesBioquimicos = filas
      .filter(({ codigo }) =>
        ['PERFIL_BASICO', 'PERFIL_GENERAL', 'PERFIL_INTEGRAL'].includes(codigo),
      )
      .map(({ categoria_id: categoriaId, codigo, nombre }) => ({
        categoria: categoriaNombrePorId[categoriaId],
        codigo,
        nombre,
      }));
    expect(perfilesBioquimicos).toEqual([
      {
        categoria: 'Química sanguínea / Bioquímica',
        codigo: 'PERFIL_BASICO',
        nombre: 'Perfil bioquímico básico (6 elementos)',
      },
      {
        categoria: 'Química sanguínea / Bioquímica',
        codigo: 'PERFIL_GENERAL',
        nombre: 'Perfil bioquímico general (12 elementos)',
      },
      {
        categoria: 'Química sanguínea / Bioquímica',
        codigo: 'PERFIL_INTEGRAL',
        nombre: 'Perfil bioquímico completo (24 elementos)',
      },
    ]);
  });

  it('solo relaciona zonas y estudios que existen en los catálogos canónicos', () => {
    const categoriaIdPorNombre = Object.fromEntries(
      CATEGORIAS.map((categoria, index) => [categoria, index + 1]),
    );
    const categoriaNombrePorId = Object.fromEntries(
      CATEGORIAS.map((categoria, index) => [index + 1, categoria]),
    );
    const estudios = new Set(
      construirFilas(categoriaIdPorNombre).map(({ categoria_id: categoriaId, nombre }) => {
        return `${categoriaNombrePorId[categoriaId]}::${nombre}`;
      }),
    );
    const zonas = new Set(ZONAS.map(([codigo]) => codigo));

    for (const [categoria, estudio, codigosZona] of CONFIGURACION) {
      expect(estudios.has(`${categoria}::${estudio}`)).toBe(true);
      expect(codigosZona.length).toBeGreaterThan(0);
      expect(codigosZona.every((codigo) => zonas.has(codigo))).toBe(true);
    }
  });
});
