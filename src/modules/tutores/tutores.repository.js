// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias).
const db = require('../../config/database');

// El texto de búsqueda decide QUÉ tutores entran al resultado — por sus
// propios campos, o porque al menos un paciente suyo (que además cumpla el
// filtro de Pacientes) coincide — sin restringir todavía qué pacientes se
// les muestran a los tutores que sí entran: esa decisión la toma
// tutores.service.js después, en JS, porque el AC distingue "coincidió por
// el tutor" (se muestran todos sus pacientes que pasen el filtro de
// Pacientes) de "coincidió por un paciente" (solo se muestran los pacientes
// que también coincidan con la búsqueda). Mismo criterio de "resolver
// primero QUÉ filas entran, después traer el detalle completo" que
// matchingDoctorIdsQuery en doctores.repository.js.
// Ajuste posterior, pedido explícito del usuario: `propietarios.telefono`
// se guarda sin guiones (ver migración normalizar_telefonos_sin_guiones y
// tutores.service.js#stripTelefono/formatTelefono) — buscar "5520108565"
// (o "55-2010-8565", da igual) debe encontrar ese teléfono. `qDigits` son
// los dígitos de `q` (puede venir vacío si `q` no tenía ninguno, ej. una
// búsqueda por nombre); esa rama del OR se omite por completo cuando viene
// vacío, para no matchear cualquier fila con un ILIKE '%%'.
function baseQuery({ q, qDigits, activoTutores, activoPacientes }) {
  return db('propietarios as p').modify((builder) => {
    if (activoTutores) builder.where('p.activo', true);
    if (q) {
      builder.where((whereBuilder) => {
        // `p.apellidos` ahora es su propia columna (antes venía pegada
        // dentro de `nombre`) — el OR por cada campo cubre buscar SOLO por
        // nombre o SOLO por apellido; el `(nombre || ' ' || apellidos)`
        // (mismo patrón ya usado para el doctor en
        // laboratorio.repository.js#baseQuery) cubre buscar el nombre
        // completo de un jalón (ej. "Juan Pérez") — sin él, una búsqueda
        // que abarque ambas palabras dejaría de encontrar al tutor, una
        // regresión real del split.
        whereBuilder
          .whereRaw('p.nombre ILIKE ?', [`%${q}%`])
          .orWhereRaw('p.apellidos ILIKE ?', [`%${q}%`])
          .orWhereRaw("(p.nombre || ' ' || p.apellidos) ILIKE ?", [`%${q}%`]);
        if (qDigits) whereBuilder.orWhereRaw('p.telefono ILIKE ?', [`%${qDigits}%`]);
        whereBuilder.orWhereRaw('p.correo ILIKE ?', [`%${q}%`]).orWhereExists(function () {
          this.select(1)
            .from('mascotas as m')
            .whereRaw('m.propietario_id = p.id')
            .modify((mascotaBuilder) => {
              if (activoPacientes) mascotaBuilder.where('m.activo', true);
            })
            .andWhere((mascotaWhere) => {
              mascotaWhere
                .whereRaw('m.nombre ILIKE ?', [`%${q}%`])
                .orWhereRaw('m.tipo ILIKE ?', [`%${q}%`])
                .orWhereRaw('m.raza ILIKE ?', [`%${q}%`]);
            });
        });
      });
    }
  });
}

async function count({ q, qDigits, activoTutores, activoPacientes }) {
  const row = await baseQuery({ q, qDigits, activoTutores, activoPacientes })
    .count('p.id as total')
    .first();
  return Number(row.total);
}

async function findPage({ q, qDigits, activoTutores, activoPacientes, limit, offset }) {
  return baseQuery({ q, qDigits, activoTutores, activoPacientes })
    .select('p.id', 'p.nombre', 'p.apellidos', 'p.telefono', 'p.correo', 'p.activo')
    .orderBy(['p.nombre', 'p.apellidos'])
    .limit(limit)
    .offset(offset);
}

// Independiente de filtros: distingue "el catálogo nunca ha tenido un
// tutor" (estado vacío con CTA) de "esta búsqueda no encontró nada" (tabla
// vacía con toolbar) — mismo criterio que existsAny() en doctores/áreas.
async function existsAny() {
  const row = await db('propietarios').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

// Pacientes de una página de tutores ya resuelta — separado de la consulta
// principal para no repetir un LEFT JOIN + agregación en cada fila cuando
// ya se sabe exactamente qué tutores se van a mostrar.
async function mascotasPorPropietarios(propietarioIds, { activoPacientes }) {
  return db('mascotas')
    .whereIn('propietario_id', propietarioIds)
    .modify((builder) => {
      if (activoPacientes) builder.where('activo', true);
    })
    .orderBy('nombre')
    .select('id', 'propietario_id', 'nombre', 'tipo', 'raza', 'activo');
}

// US-156: para precargar el formulario de edición.
async function findById(id) {
  return db('propietarios').where({ id }).first();
}

// US-156 AC5/AC6: chequeo de duplicados de teléfono — `propietarios.telefono`
// es UNIQUE de verdad a nivel de base de datos, así que esto no es solo una
// regla de negocio: sin este chequeo previo, un INSERT/UPDATE con un
// teléfono repetido tronaría con un error de Postgres crudo en vez del
// mensaje del AC. `excludeId` se usa en edición, para no considerar al
// propio registro que se está editando como su propio duplicado.
async function findByTelefono(telefono, excludeId) {
  return db('propietarios')
    .where({ telefono })
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .first();
}

// Laboratorio: combobox de "buscar tutor por nombre" en "Nuevo registro"
// (pedido explícito del usuario, para cuando no se sabe el teléfono) — solo
// tutores ACTIVOS, mismo criterio que findByTelefono() en
// resolverTutorActivoPorTelefono. Resultado acotado por `limit`: es un
// combobox de escritura incremental, no un listado paginado.
async function findActivosPorNombre(q, limit) {
  return db('propietarios')
    .where('activo', true)
    .where((builder) => {
      builder
        .whereRaw('nombre ILIKE ?', [`%${q}%`])
        .orWhereRaw('apellidos ILIKE ?', [`%${q}%`])
        .orWhereRaw("(nombre || ' ' || apellidos) ILIKE ?", [`%${q}%`]);
    })
    .orderBy(['nombre', 'apellidos'])
    .limit(limit)
    .select('id', 'nombre', 'apellidos', 'telefono');
}

// US-156 AC14: mascotas de un propietario para el formulario de edición —
// a diferencia de mascotasPorPropietarios (listado, US-155), aquí siempre
// se traen TODAS (activas e inactivas), porque el formulario necesita
// poder mostrar/reactivar una mascota inactiva (AC18/19), no solo las que
// pasan el filtro de un listado.
async function findMascotasByPropietarioId(propietarioId) {
  return db('mascotas')
    .where({ propietario_id: propietarioId })
    .orderBy('nombre')
    .select('id', 'nombre', 'tipo', 'raza', 'sexo', 'anio_nacimiento', 'activo');
}

// US-156 AC7/AC8/AC12/AC13: alta — inserta el propietario y sus mascotas
// (puede ser ninguna) en una sola transacción (AC23: si algo falla, no
// debe quedar ni el propietario ni ninguna mascota a medias).
async function crear({ nombre, apellidos, telefono, correo, pacientes, usuarioId }) {
  return db.transaction(async (trx) => {
    const [row] = await trx('propietarios')
      .insert({
        nombre,
        apellidos,
        telefono,
        correo,
        activo: true,
        creado_por: usuarioId,
        creado_en: trx.fn.now(),
      })
      .returning('id');

    if (pacientes.length) {
      await trx('mascotas').insert(
        pacientes.map((p) => ({
          propietario_id: row.id,
          nombre: p.nombre,
          tipo: p.tipo || null,
          raza: p.raza || null,
          sexo: p.sexo || null,
          anio_nacimiento: p.anioNacimiento ?? null,
          activo: true,
          creado_por: usuarioId,
          creado_en: trx.fn.now(),
        })),
      );
    }

    return row.id;
  });
}

// US-156 AC15/16/17/19: edición — actualiza el propietario y, por cada
// paciente que llega en el body: si trae `id`, actualiza esa mascota
// (nombre/tipo/raza/sexo/anio_nacimiento siempre; `activo` solo si hubo una transición real,
// comparada contra el valor actual en BD DENTRO de la misma transacción —
// mismo criterio que doctores.repository.js#editar para no pisar
// desactivado_por/desactivado_en en cada guardado, solo en una transición
// de verdad); si no trae `id`, es una mascota nueva (activo=true siempre,
// AC13). Todo en una transacción (AC23).
//
// Pedido explícito del usuario: `activo` del propietario (switch de
// Estado, ver tutor-form.ejs) sigue el MISMO criterio de transición-real
// que cada mascota de abajo — nunca cascada a las mascotas (a diferencia
// de desactivar(), más abajo, que sí las da de baja junto con el
// propietario): cada mascota ya se controla con su propio switch en esta
// misma pantalla, tocarlas también desde aquí las pisaría en silencio.
// `activo === undefined` (no vino en el body, ver
// tutores.service.js#normalizeActivoOpcional) dejar el estado actual tal
// cual, sin comparar ni tocar desactivado_por/desactivado_en.
async function editar({ id, nombre, apellidos, telefono, correo, activo, pacientes, usuarioId }) {
  await db.transaction(async (trx) => {
    const update = {
      nombre,
      apellidos,
      telefono,
      correo,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    };

    if (activo !== undefined) {
      const actual = await trx('propietarios').where({ id }).first('activo');
      if (actual.activo && !activo) {
        update.activo = false;
        update.desactivado_por = usuarioId;
        update.desactivado_en = trx.fn.now();
      } else if (!actual.activo && activo) {
        update.activo = true;
        update.desactivado_por = null;
        update.desactivado_en = null;
      }
    }

    await trx('propietarios').where({ id }).update(update);

    for (const paciente of pacientes) {
      if (paciente.id) {
        const actual = await trx('mascotas').where({ id: paciente.id }).first('activo');
        const update = {
          nombre: paciente.nombre,
          tipo: paciente.tipo || null,
          raza: paciente.raza || null,
          sexo: paciente.sexo || null,
          anio_nacimiento: paciente.anioNacimiento ?? null,
          actualizado_por: usuarioId,
          actualizado_en: trx.fn.now(),
        };
        if (actual.activo && !paciente.activo) {
          update.activo = false;
          update.desactivado_por = usuarioId;
          update.desactivado_en = trx.fn.now();
        } else if (!actual.activo && paciente.activo) {
          update.activo = true;
          update.desactivado_por = null;
          update.desactivado_en = null;
        }
        await trx('mascotas').where({ id: paciente.id }).update(update);
      } else {
        await trx('mascotas').insert({
          propietario_id: id,
          nombre: paciente.nombre,
          tipo: paciente.tipo || null,
          raza: paciente.raza || null,
          sexo: paciente.sexo || null,
          anio_nacimiento: paciente.anioNacimiento ?? null,
          activo: true,
          creado_por: usuarioId,
          creado_en: trx.fn.now(),
        });
      }
    }
  });
}

// US-156 AC5 (reactivación en alta, decidida con el usuario): el teléfono
// capturado pertenece a un propietario YA INACTIVO — en vez de un INSERT
// nuevo (que violaría el UNIQUE de propietarios.telefono), se reactiva ESE
// mismo registro con los datos de este formulario, mismo criterio que
// areas.repository.js#reactivar. Nunca se usa desde editar() (mismo
// criterio que areas.service.js#editar: "no hay reactivar al editar, sería
// fusionar la identidad de dos registros distintos").
//
// Ajuste posterior (pedido del usuario): `pacientes` ya no llega siempre
// vacío/sin ids — el formulario de alta ahora puede precargarse con las
// mascotas YA EXISTENTES del propietario inactivo (para "mostrar toda su
// información y mascotas" antes de reactivar). Un INSERT ciego de todo el
// arreglo las hubiera duplicado; el mismo criterio de editar() de arriba
// (con `id` → UPDATE, sin `id` → INSERT nueva) evita eso.
async function reactivar({ id, nombre, apellidos, telefono, correo, pacientes, usuarioId }) {
  return db.transaction(async (trx) => {
    await trx('propietarios').where({ id }).update({
      nombre,
      apellidos,
      telefono,
      correo,
      activo: true,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
      desactivado_por: null,
      desactivado_en: null,
    });

    for (const paciente of pacientes) {
      if (paciente.id) {
        const actual = await trx('mascotas').where({ id: paciente.id }).first('activo');
        const update = {
          nombre: paciente.nombre,
          tipo: paciente.tipo || null,
          raza: paciente.raza || null,
          sexo: paciente.sexo || null,
          anio_nacimiento: paciente.anioNacimiento ?? null,
          actualizado_por: usuarioId,
          actualizado_en: trx.fn.now(),
        };
        if (actual.activo && !paciente.activo) {
          update.activo = false;
          update.desactivado_por = usuarioId;
          update.desactivado_en = trx.fn.now();
        } else if (!actual.activo && paciente.activo) {
          update.activo = true;
          update.desactivado_por = null;
          update.desactivado_en = null;
        }
        await trx('mascotas').where({ id: paciente.id }).update(update);
      } else {
        await trx('mascotas').insert({
          propietario_id: id,
          nombre: paciente.nombre,
          tipo: paciente.tipo || null,
          raza: paciente.raza || null,
          sexo: paciente.sexo || null,
          anio_nacimiento: paciente.anioNacimiento ?? null,
          activo: true,
          creado_por: usuarioId,
          creado_en: trx.fn.now(),
        });
      }
    }

    return id;
  });
}

// US-156 (pedido del usuario tras el alta/edición, ajustado después):
// sugiere propietarios ya existentes mientras se captura el teléfono en el
// formulario de ALTA — incremental: sin texto, muestra los primeros
// `limit`; con texto, filtra por coincidencia parcial. SOLO activos a
// propósito (decidido con el usuario): un propietario inactivo con ese
// teléfono NO debe aparecer aquí, para no ofrecer un atajo que se salte el
// flujo real de reactivación (confirmación explícita en el guardado del
// alta, ver crear() en tutores.service.js) — este listado es solo para
// avisar "ya existe un cliente ACTIVO con este número", nada más.
async function searchByTelefono(q, limit) {
  return db('propietarios')
    .where('activo', true)
    .modify((builder) => {
      if (q) builder.whereRaw('telefono ILIKE ?', [`%${q}%`]);
    })
    .orderBy('telefono')
    .limit(limit)
    .select('id', 'nombre', 'apellidos', 'telefono');
}

// Agenda: combobox de "Mascota" del formulario de citas — mismo criterio
// que searchByTelefono (incremental, solo activos), pero busca por el
// nombre de la mascota (el catálogo puede crecer mucho, a diferencia de
// áreas/doctores no se precarga entero). Solo mascotas de propietarios
// también activos — no tendría sentido ofrecer agendar a la mascota de un
// tutor dado de baja.
// Agenda: resuelve una mascota por su propio id (no por propietario) —
// para repoblar el combobox del formulario de citas en dos casos: precargar
// la edición de una cita existente, y re-mostrar la selección tras un
// re-render por error de validación (mismo criterio que
// usuarios.service.js#resolverDoctor).
async function findMascotaById(id) {
  return db('mascotas as m')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .where('m.id', id)
    .first(
      'm.id',
      'm.nombre',
      'm.tipo',
      'p.id as propietario_id',
      'p.nombre as propietario_nombre',
      'p.apellidos as propietario_apellidos',
    );
}

// Pedido explícito del usuario: buscar por Mascota, Dueño o teléfono —
// mismo criterio de `qDigits` (dígitos de `q`, rama del OR omitida si viene
// vacía) que tutores.repository.js#baseQuery.
async function searchMascotas(q, qDigits, limit) {
  return db('mascotas as m')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .where('m.activo', true)
    .andWhere('p.activo', true)
    .modify((builder) => {
      if (q) {
        builder.andWhere((whereBuilder) => {
          whereBuilder
            .whereRaw('m.nombre ILIKE ?', [`%${q}%`])
            .orWhereRaw('p.nombre ILIKE ?', [`%${q}%`])
            .orWhereRaw('p.apellidos ILIKE ?', [`%${q}%`])
            .orWhereRaw("(p.nombre || ' ' || p.apellidos) ILIKE ?", [`%${q}%`]);
          if (qDigits) whereBuilder.orWhereRaw('p.telefono ILIKE ?', [`%${qDigits}%`]);
        });
      }
    })
    .orderBy('m.nombre')
    .limit(limit)
    .select(
      'm.id',
      'm.nombre',
      'm.tipo',
      'p.id as propietario_id',
      'p.nombre as propietario_nombre',
      'p.apellidos as propietario_apellidos',
    );
}

// US-157 (ajustado después, pedido del usuario): baja lógica, nunca DELETE
// físico — el historial de citas/laboratorio sigue referenciando a este
// propietario vía propietario_id, que nunca se toca. La baja SÍ cascada a
// sus mascotas (activo=false + desactivado_por/desactivado_en, igual que la
// transición individual de editar()) — a diferencia de reactivar(), que
// solo reactiva al propietario y deja tal cual las mascotas que ya estaban
// inactivas (se reactivan una por una desde el switch de editar).
async function desactivar(id, usuarioId) {
  await db.transaction(async (trx) => {
    await trx('propietarios').where({ id }).update({
      activo: false,
      desactivado_por: usuarioId,
      desactivado_en: trx.fn.now(),
    });
    await trx('mascotas').where({ propietario_id: id, activo: true }).update({
      activo: false,
      desactivado_por: usuarioId,
      desactivado_en: trx.fn.now(),
    });
  });
}

module.exports = {
  count,
  findPage,
  existsAny,
  mascotasPorPropietarios,
  findById,
  findByTelefono,
  findActivosPorNombre,
  findMascotasByPropietarioId,
  crear,
  editar,
  reactivar,
  searchByTelefono,
  findMascotaById,
  searchMascotas,
  desactivar,
};
