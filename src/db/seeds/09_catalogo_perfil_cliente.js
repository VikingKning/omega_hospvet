const { construirFilas } = require('./04_catalogo_estudios');

const PERFILES_VALIDOS = new Set(['completo', 'omega']);

const ESTUDIOS_OMEGA = [
  {
    categoria: 'Hematología',
    codigo: 'OMEGA_HEMOGRAMA',
    nombre: 'Hemograma',
  },
  {
    categoria: 'Química sanguínea / Bioquímica',
    codigo: 'OMEGA_QUIMICA_SANGUINEA',
    nombre: 'Química sanguínea',
  },
  {
    categoria: 'Uroanálisis',
    codigo: 'OMEGA_URIANALISIS',
    nombre: 'Urianálisis',
  },
  {
    categoria: 'Perfiles clínicos / Paneles',
    codigo: 'OMEGA_PERFIL_TIROIDEO',
    nombre: 'Perfil tiroideo',
  },
  {
    categoria: 'Perfiles clínicos / Paneles',
    codigo: 'OMEGA_PERFIL_CUSHING',
    nombre: 'Perfil de Cushing',
  },
  {
    categoria: 'Enfermedades infecciosas - Gato',
    codigo: 'OMEGA_KIT_SIDA_LEUCEMIA',
    nombre: 'Kit sida/leucemia',
    especie: 'Gato',
  },
  {
    categoria: 'Enfermedades infecciosas - Perro',
    codigo: 'OMEGA_KIT_DISTEMPER',
    nombre: 'Kit Distemper',
    especie: 'Perro',
  },
  {
    categoria: 'Gastroenterología',
    codigo: 'OMEGA_KIT_TRIPLE_DIGESTIVO',
    nombre: 'Kit triple digestivo',
  },
  {
    categoria: 'Química sanguínea / Bioquímica',
    codigo: 'OMEGA_SDMA',
    nombre: 'SDMA',
  },
  {
    categoria: 'Imagenología',
    codigo: 'OMEGA_INFORME_RADIOGRAFICO',
    nombre: 'Informe de estudio radiográfico',
  },
  {
    categoria: 'Imagenología',
    codigo: 'OMEGA_INFORME_ULTRASONIDO',
    nombre: 'Informe de ultrasonido',
  },
  {
    categoria: 'Parasitología',
    codigo: 'OMEGA_COPROPARASITOSCOPICO',
    nombre: 'Coproparasitoscópico',
  },
  {
    categoria: 'Otros',
    codigo: 'OMEGA_OTRO',
    nombre: 'Otro',
  },
];

function resolverPerfil(rawPerfil = process.env.CATALOGO_ESTUDIOS_PERFIL) {
  const perfil = String(rawPerfil || 'completo')
    .trim()
    .toLowerCase();
  if (!PERFILES_VALIDOS.has(perfil)) {
    throw new Error(
      `CATALOGO_ESTUDIOS_PERFIL debe ser "completo" u "omega"; se recibió "${perfil}".`,
    );
  }
  return perfil;
}

function construirFilasOmega(categoriaIdPorNombre) {
  return ESTUDIOS_OMEGA.map((estudio) => {
    const categoriaId = categoriaIdPorNombre[estudio.categoria];
    if (!categoriaId) {
      throw new Error(
        `Categoría "${estudio.categoria}" no existe en catalogo_categorias_estudio — revisa 03_catalogo_categorias_estudio.js`,
      );
    }
    return {
      categoria_id: categoriaId,
      codigo: estudio.codigo,
      nombre: estudio.nombre,
      campo_adicional: null,
      especie: estudio.especie ?? null,
      permite_antibiograma: false,
      activo: false,
    };
  });
}

async function aplicarPerfil(knex, rawPerfil = process.env.CATALOGO_ESTUDIOS_PERFIL) {
  const perfil = resolverPerfil(rawPerfil);

  await knex.transaction(async (trx) => {
    await trx('catalogo_categorias_estudio')
      .insert({ nombre: 'Otros', activo: true })
      .onConflict('nombre')
      .merge({ activo: true });

    const categorias = await trx('catalogo_categorias_estudio').select('id', 'nombre');
    const categoriaIdPorNombre = Object.fromEntries(categorias.map((c) => [c.nombre, c.id]));
    const filasOmega = construirFilasOmega(categoriaIdPorNombre);

    await trx('catalogo_estudios')
      .insert(filasOmega)
      .onConflict('codigo')
      .merge(['categoria_id', 'nombre', 'campo_adicional', 'especie', 'permite_antibiograma']);

    const codigosActivos =
      perfil === 'omega'
        ? filasOmega.map(({ codigo }) => codigo)
        : construirFilas(categoriaIdPorNombre).map(({ codigo }) => codigo);

    await trx('catalogo_estudios').update({ activo: false });
    await trx('catalogo_estudios').whereIn('codigo', codigosActivos).update({ activo: true });
  });

  return perfil;
}

exports.seed = async function seed(knex) {
  await aplicarPerfil(knex);
};

exports.ESTUDIOS_OMEGA = ESTUDIOS_OMEGA;
exports.PERFILES_VALIDOS = PERFILES_VALIDOS;
exports.resolverPerfil = resolverPerfil;
exports.construirFilasOmega = construirFilasOmega;
exports.aplicarPerfil = aplicarPerfil;
