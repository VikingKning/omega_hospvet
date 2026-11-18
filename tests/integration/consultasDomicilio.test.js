const db = require('../../src/config/database');
const migracion = require('../../src/db/migrations/20261118000003_renombrar_consultas_domicilio');

let trx;

beforeEach(async () => {
  trx = await db.transaction();
  await trx('areas').where({ slug: 'consultas' }).update({ nombre: 'Consultas', activo: false });
  await trx('configuracion_funciones')
    .where({ clave: 'whatsapp_citas_consultas' })
    .update({ habilitado: false });
});

afterEach(async () => {
  await trx.rollback();
});

afterAll(async () => {
  await db.destroy();
});

describe('renombrar la agenda existente a Consultas Domicilio', () => {
  it('conserva IDs, citas, Google, permisos otorgados y estados al cambiar las etiquetas', async () => {
    const area = await trx('areas').where({ slug: 'consultas' }).first();
    const otrasAreas = await trx('areas').whereNot('id', area.id).orderBy('id');
    const permisos = await trx('permissions').where({ modulo: 'agenda_consultas' }).orderBy('id');
    const asignaciones = await trx('usuario_permisos')
      .whereIn(
        'permission_id',
        permisos.map(({ id }) => id),
      )
      .orderBy(['usuario_id', 'permission_id']);
    const funcion = await trx('configuracion_funciones')
      .where({ clave: 'whatsapp_citas_consultas' })
      .first();
    const doctor = await trx('doctores').where({ es_predeterminado: true }).first();
    const [cita] = await trx('citas')
      .insert({
        area_id: area.id,
        doctor_id: doctor.id,
        mascota_id: null,
        fecha_hora_inicio: new Date(Date.now() + 86400000),
        duracion_minutos: 30,
        motivo: 'Reserva pendiente de vincular tutor',
        estado: 'registrada',
        origen: 'reserva_externa',
        google_event_id: 'reserva-consultas-domicilio-prueba',
        creado_en: trx.fn.now(),
      })
      .returning('*');

    await migracion.up(trx);

    expect(await trx('areas').where({ id: area.id }).first()).toEqual({
      ...area,
      nombre: 'Consultas Domicilio',
    });
    expect(await trx('citas').where({ id: cita.id }).first()).toEqual(cita);
    expect(await trx('areas').whereNot('id', area.id).orderBy('id')).toEqual(otrasAreas);
    const actualizados = await trx('permissions')
      .where({ modulo: 'agenda_consultas' })
      .orderBy('id');
    expect(actualizados).toHaveLength(5);
    expect(actualizados.map(({ descripcion: _descripcion, ...permiso }) => permiso)).toEqual(
      permisos.map(({ descripcion: _descripcion, ...permiso }) => permiso),
    );
    expect(
      actualizados.every(({ descripcion }) => descripcion.endsWith('Consultas Domicilio')),
    ).toBe(true);
    expect(
      await trx('usuario_permisos')
        .whereIn(
          'permission_id',
          permisos.map(({ id }) => id),
        )
        .orderBy(['usuario_id', 'permission_id']),
    ).toEqual(asignaciones);
    expect(await trx('configuracion_funciones').where({ clave: funcion.clave }).first()).toEqual({
      ...funcion,
      nombre: 'Citas de Consultas Domicilio',
      descripcion: 'Permite ofrecer el flujo de citas para Consultas Domicilio por WhatsApp.',
    });
  });

  it('se puede repetir y revertir sin crear otra agenda ni reactivar opciones deshabilitadas', async () => {
    const antes = await trx('areas').where({ slug: 'consultas' }).first();
    await migracion.up(trx);
    await migracion.up(trx);
    expect(await trx('areas').where({ slug: 'consultas' })).toHaveLength(1);
    expect(await trx('areas').where({ nombre: 'Consultas Domicilio' }).first('id')).toEqual({
      id: antes.id,
    });

    await migracion.down(trx);
    expect(await trx('areas').where({ slug: 'consultas' }).first()).toEqual(antes);
    expect(
      await trx('configuracion_funciones')
        .where({ clave: 'whatsapp_citas_consultas' })
        .first('habilitado', 'nombre'),
    ).toEqual({ habilitado: false, nombre: 'Citas de Consultas' });
    expect(
      await trx('permissions').where({ codigo: 'agenda.consultas.ver' }).first('descripcion'),
    ).toEqual({ descripcion: 'Ver citas de Consultas' });
  });
});
