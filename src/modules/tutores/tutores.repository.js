const db = require('../../config/database');
const consentimientoLfpdppp = require('../whatsapp/whatsapp.consentimiento.repository');

// LFPDPPP: dar de alta (o reactivar) un tutor desde el panel asume que
// recepción ya recabó el consentimiento físico en ese momento — se registra
// de una vez con acepto=true, canal='panel', para que si ese mismo teléfono
// escribe por WhatsApp no se le pida el aviso de nuevo. `onConflict` no
// aplica aquí (no hay unique en telefono de esta tabla), así que basta con
// insertar una fila más; evaluarEstado() siempre lee la más reciente.
async function registrarConsentimientoPorAltaPanel(telefono, propietarioId, trx) {
  await consentimientoLfpdppp.insertarConsentimientoPanel(
    { telefono: `52${telefono}`, propietarioId },
    trx,
  );
}

function baseQuery({ q, qDigits, activoTutores, activoPacientes }) {
  return db('propietarios as p').modify((builder) => {
    if (activoTutores) builder.where('p.activo', true);
    if (q) {
      builder.where((whereBuilder) => {
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
              if (qDigits) {
                const nhcBuscado = Number(qDigits);
                if (Number.isInteger(nhcBuscado) && nhcBuscado <= 99999999) {
                  mascotaWhere.orWhere('m.nhc', nhcBuscado);
                }
              }
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

async function existsAny() {
  const row = await db('propietarios').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

async function mascotasPorPropietarios(propietarioIds, { activoPacientes }) {
  return db('mascotas')
    .whereIn('propietario_id', propietarioIds)
    .modify((builder) => {
      if (activoPacientes) builder.where('activo', true);
    })
    .orderBy('nombre')
    .select('id', 'propietario_id', 'nhc', 'nombre', 'tipo', 'raza', 'activo');
}

async function findById(id) {
  return db('propietarios').where({ id }).first();
}

async function findByTelefono(telefono, excludeId) {
  return db('propietarios')
    .where({ telefono })
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .first();
}

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

async function findMascotasByPropietarioId(propietarioId) {
  return db('mascotas')
    .where({ propietario_id: propietarioId })
    .orderBy('nombre')
    .select('id', 'nhc', 'nombre', 'tipo', 'raza', 'sexo', 'anio_nacimiento', 'activo');
}

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
          nhc: p.nhc,
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

    await registrarConsentimientoPorAltaPanel(telefono, row.id, trx);

    return row.id;
  });
}

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
          nhc: paciente.nhc,
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
          nhc: paciente.nhc,
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
          nhc: paciente.nhc,
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
          nhc: paciente.nhc,
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

    await registrarConsentimientoPorAltaPanel(telefono, id, trx);

    return id;
  });
}

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

async function findMascotaById(id) {
  return db('mascotas as m')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .where('m.id', id)
    .first(
      'm.id',
      'm.nhc',
      'm.nombre',
      'm.tipo',
      'p.id as propietario_id',
      'p.nombre as propietario_nombre',
      'p.apellidos as propietario_apellidos',
    );
}

async function findMascotaActivaByNhc(nhc) {
  return db('mascotas as m')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .where({ 'm.nhc': nhc, 'm.activo': true, 'p.activo': true })
    .first(
      'm.id',
      'm.nhc',
      'm.nombre',
      'm.tipo',
      'm.raza',
      'm.sexo',
      'm.anio_nacimiento',
      'p.id as propietario_id',
    );
}

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
  findMascotaActivaByNhc,
  searchMascotas,
  desactivar,
};
