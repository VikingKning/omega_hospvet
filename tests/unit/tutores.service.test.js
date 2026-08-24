// US-155: catálogo de Tutores y Pacientes (listado). El repository se
// mockea porque lo interesante de este service NO es el SQL (eso ya lo
// prueba tutores.test.js contra una base real) sino la lógica en JS que
// decide, para cada tutor ya resuelto por la consulta, QUÉ pacientes se le
// muestran cuando hay una búsqueda de texto activa — el AC distingue
// "coincidió por el propio tutor" (se muestran todos sus pacientes que ya
// pasaron el filtro de estado) de "coincidió solo por un paciente" (se
// muestran únicamente los pacientes que también coinciden con la
// búsqueda), y esa rama es la parte más fácil de romper sin darse cuenta.
jest.mock('../../src/modules/tutores/tutores.repository');
const repository = require('../../src/modules/tutores/tutores.repository');
const {
  list,
  obtenerParaEditar,
  crear,
  editar,
  buscarPorTelefono,
  verificarTelefono,
  TutorValidationError,
  RequiereConfirmacionReactivacionError,
} = require('../../src/modules/tutores/tutores.service');
const db = require('../../src/config/database');

afterAll(() => db.destroy());

// Ajuste posterior, pedido explícito del usuario: lo que devuelve el
// repository (y por lo tanto lo que representa este fixture) ya no trae
// guiones — el formato NN-NNNN-NNNN se guarda sin ellos desde ahora, ver
// tutores.service.js#stripTelefono/formatTelefono.
const TUTOR = {
  id: 1,
  nombre: 'Juan Pérez',
  telefono: '5551234567',
  correo: 'juan@correo.com',
  activo: true,
};
const MASCOTA_A = {
  id: 10,
  propietario_id: 1,
  nombre: 'Firulais',
  tipo: 'Perro',
  raza: 'Labrador',
  activo: true,
};
const MASCOTA_B = {
  id: 11,
  propietario_id: 1,
  nombre: 'Michi',
  tipo: 'Gato',
  raza: 'Siamés',
  activo: true,
};

describe('tutores.service.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(1);
    repository.findPage.mockResolvedValue([TUTOR]);
    repository.mascotasPorPropietarios.mockResolvedValue([MASCOTA_A, MASCOTA_B]);
  });

  it('AC11: por defecto (sin estado) filtra tutores solo activos', async () => {
    await list({});
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ activoTutores: true }),
    );
  });

  it('AC12: estadoTutores=todos desactiva el filtro de activos de tutores', async () => {
    await list({ estadoTutores: 'todos' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ activoTutores: false }),
    );
  });

  it('AC13: por defecto (sin estado) filtra pacientes solo activos', async () => {
    await list({});
    expect(repository.mascotasPorPropietarios).toHaveBeenCalledWith([1], { activoPacientes: true });
  });

  it('AC14: estadoPacientes=todos desactiva el filtro de activos de pacientes', async () => {
    await list({ estadoPacientes: 'todos' });
    expect(repository.mascotasPorPropietarios).toHaveBeenCalledWith([1], {
      activoPacientes: false,
    });
  });

  it('AC15: los dos filtros de estado se aplican de forma independiente', async () => {
    await list({ estadoTutores: 'todos', estadoPacientes: 'activos' });
    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ activoTutores: false }),
    );
    expect(repository.mascotasPorPropietarios).toHaveBeenCalledWith([1], { activoPacientes: true });
  });

  it('sin búsqueda, un tutor muestra TODOS sus pacientes ya filtrados por estado', async () => {
    const result = await list({});
    expect(result.tutores[0].pacientes).toEqual([MASCOTA_A, MASCOTA_B]);
  });

  it('AC8: búsqueda que coincide con el tutor muestra TODOS sus pacientes, no solo el que también coincidiera', async () => {
    const result = await list({ q: 'Juan' }); // coincide con tutor.nombre
    expect(result.tutores[0].pacientes).toEqual([MASCOTA_A, MASCOTA_B]);
  });

  it('AC10: búsqueda que coincide con teléfono o correo del tutor también cuenta como "coincidió por el tutor"', async () => {
    const porTelefono = await list({ q: '55-5123-4567' });
    expect(porTelefono.tutores[0].pacientes).toEqual([MASCOTA_A, MASCOTA_B]);

    const porCorreo = await list({ q: 'juan@correo.com' });
    expect(porCorreo.tutores[0].pacientes).toEqual([MASCOTA_A, MASCOTA_B]);
  });

  it('AC9: búsqueda que solo coincide con un paciente muestra al tutor con ÚNICAMENTE los pacientes que coinciden', async () => {
    const result = await list({ q: 'Firulais' }); // no coincide con nada del tutor
    expect(result.tutores[0].pacientes).toEqual([MASCOTA_A]);
  });

  it('AC10: la búsqueda por paciente también coincide por tipo o raza, no solo por nombre', async () => {
    const porTipo = await list({ q: 'gato' });
    expect(porTipo.tutores[0].pacientes).toEqual([MASCOTA_B]);

    const porRaza = await list({ q: 'labrador' });
    expect(porRaza.tutores[0].pacientes).toEqual([MASCOTA_A]);
  });

  it('AC7: un tutor sin pacientes que cumplan el filtro/búsqueda queda con un arreglo vacío', async () => {
    repository.mascotasPorPropietarios.mockResolvedValue([]);
    const result = await list({});
    expect(result.tutores[0].pacientes).toEqual([]);
  });

  it('una página inválida cae a la página 1, no truena', async () => {
    const result = await list({ page: 'no-es-un-numero' });
    expect(result.page).toBe(1);
  });

  it('una página fuera de rango se recorta al total de páginas', async () => {
    repository.count.mockResolvedValue(3); // 3 tutores, PAGE_SIZE=10 => 1 sola página
    const result = await list({ page: '99' });
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('catalogoVacio es true solo cuando no existe ningún tutor (sin importar filtros)', async () => {
    repository.existsAny.mockResolvedValue(false);
    const result = await list({});
    expect(result.catalogoVacio).toBe(true);
  });

  it('catalogoVacio es false si hay tutores aunque esta búsqueda no encuentre nada', async () => {
    repository.existsAny.mockResolvedValue(true);
    repository.count.mockResolvedValue(0);
    repository.findPage.mockResolvedValue([]);
    const result = await list({ q: 'no existe' });
    expect(result.catalogoVacio).toBe(false);
  });

  it('sin tutores en la página, nunca consulta pacientes (evita un IN() vacío innecesario)', async () => {
    repository.findPage.mockResolvedValue([]);
    await list({});
    expect(repository.mascotasPorPropietarios).not.toHaveBeenCalled();
  });
});

describe('tutores.service.obtenerParaEditar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('AC2/AC14: trae el propietario con TODAS sus mascotas (activas e inactivas)', async () => {
    repository.findById.mockResolvedValue(TUTOR);
    repository.findMascotasByPropietarioId.mockResolvedValue([MASCOTA_A, MASCOTA_B]);

    const result = await obtenerParaEditar('1');

    // Ajuste posterior (pedido del usuario): se reformatea a NN-NNNN-NNNN
    // para precargar el <input> del formulario de edición.
    expect(result).toEqual({
      ...TUTOR,
      telefono: '55-5123-4567',
      pacientes: [MASCOTA_A, MASCOTA_B],
    });
    expect(repository.findMascotasByPropietarioId).toHaveBeenCalledWith(1);
  });

  it('un id inexistente devuelve undefined, no truena', async () => {
    repository.findById.mockResolvedValue(undefined);
    const result = await obtenerParaEditar('999');
    expect(result).toBeUndefined();
  });

  it('un id inválido devuelve undefined sin tocar el repository', async () => {
    const result = await obtenerParaEditar('no-es-un-id');
    expect(result).toBeUndefined();
    expect(repository.findById).not.toHaveBeenCalled();
  });
});

describe('tutores.service.crear (US-156 AC7-AC13)', () => {
  const DATOS_VALIDOS = {
    nombre: 'Juan Pérez',
    telefono: '55-5123-4567',
    correo: 'juan@correo.com',
    pacientes: [],
    usuarioId: 99,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByTelefono.mockResolvedValue(undefined);
    repository.crear.mockResolvedValue(1);
  });

  it('AC3: el nombre es obligatorio', async () => {
    await expect(crear({ ...DATOS_VALIDOS, nombre: '  ' })).rejects.toThrow(TutorValidationError);
  });

  it('AC3: el teléfono es obligatorio', async () => {
    await expect(crear({ ...DATOS_VALIDOS, telefono: '' })).rejects.toThrow(TutorValidationError);
  });

  // Pedido del usuario (posterior al AC): el teléfono sigue el mismo
  // formato mexicano NN-NNNN-NNNN ya establecido en el resto del sistema
  // (perfil.service.js#TELEFONO_REGEX) — a diferencia de perfil (opcional),
  // en tutores es obligatorio, pero el FORMATO en sí es idéntico.
  it('un teléfono con formato inválido se rechaza con el mensaje exacto', async () => {
    await expect(crear({ ...DATOS_VALIDOS, telefono: '5551234567' })).rejects.toThrow(
      'El teléfono debe tener el formato NN-NNNN-NNNN.',
    );
  });

  it('un teléfono incompleto (menos de 10 dígitos) se rechaza', async () => {
    await expect(crear({ ...DATOS_VALIDOS, telefono: '55-1234' })).rejects.toThrow(
      TutorValidationError,
    );
  });

  it('el correo es opcional', async () => {
    await expect(crear({ ...DATOS_VALIDOS, correo: '' })).resolves.toBe(1);
  });

  it('un correo con formato inválido se rechaza', async () => {
    await expect(crear({ ...DATOS_VALIDOS, correo: 'no-es-un-correo' })).rejects.toThrow(
      TutorValidationError,
    );
  });

  it('AC7: sin colisión de teléfono, inserta directo (no reactiva nada)', async () => {
    await crear(DATOS_VALIDOS);
    // Ajuste posterior (pedido del usuario): lo que se guarda en BD son
    // solo los 10 dígitos, sin guiones — el input SÍ los trae (look and
    // feel), pero tutores.service.js#validateTelefono los quita antes de
    // pasarle el valor al repository.
    expect(repository.crear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Juan Pérez', telefono: '5551234567' }),
    );
    expect(repository.reactivar).not.toHaveBeenCalled();
  });

  it('AC5: teléfono de otro propietario ACTIVO se rechaza', async () => {
    repository.findByTelefono.mockResolvedValue({
      id: 5,
      nombre: 'Otro',
      telefono: '5551234567',
      activo: true,
    });
    await expect(crear(DATOS_VALIDOS)).rejects.toThrow(TutorValidationError);
    expect(repository.crear).not.toHaveBeenCalled();
    expect(repository.reactivar).not.toHaveBeenCalled();
  });

  it('AC5 (decidido con el usuario): teléfono de un propietario INACTIVO, sin confirmar, pide confirmación en vez de guardar', async () => {
    repository.findByTelefono.mockResolvedValue({
      id: 5,
      nombre: 'Tutor Inactivo',
      telefono: '5551234567',
      activo: false,
    });

    await expect(crear({ ...DATOS_VALIDOS, confirmarReactivacion: false })).rejects.toThrow(
      RequiereConfirmacionReactivacionError,
    );
    expect(repository.crear).not.toHaveBeenCalled();
    expect(repository.reactivar).not.toHaveBeenCalled();
  });

  it('el error de confirmación trae el nombre/teléfono del propietario existente, para mostrarlos en el modal', async () => {
    repository.findByTelefono.mockResolvedValue({
      id: 5,
      nombre: 'Tutor Inactivo',
      telefono: '5551234567',
      activo: false,
    });

    try {
      await crear(DATOS_VALIDOS);
      throw new Error('no debió llegar aquí');
    } catch (err) {
      expect(err).toBeInstanceOf(RequiereConfirmacionReactivacionError);
      // El teléfono guardado (5551234567, sin guiones) se reformatea a
      // NN-NNNN-NNNN solo para mostrarlo en el modal — nunca se guarda así.
      expect(err.tutorExistente).toEqual({ nombre: 'Tutor Inactivo', telefono: '55-5123-4567' });
    }
  });

  it('AC5 (decidido con el usuario): con confirmarReactivacion=true, reactiva el registro existente en vez de insertar uno nuevo', async () => {
    repository.findByTelefono.mockResolvedValue({
      id: 5,
      nombre: 'Tutor Inactivo',
      telefono: '5551234567',
      activo: false,
    });
    repository.reactivar.mockResolvedValue(5);

    const id = await crear({ ...DATOS_VALIDOS, confirmarReactivacion: true });

    expect(id).toBe(5);
    expect(repository.reactivar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, nombre: 'Juan Pérez', telefono: '5551234567' }),
    );
    expect(repository.crear).not.toHaveBeenCalled();
  });

  it('AC11: cada paciente necesita como mínimo Nombre (Tipo/Raza son opcionales)', async () => {
    await expect(
      crear({ ...DATOS_VALIDOS, pacientes: [{ nombre: '', tipo: 'Perro', raza: 'Labrador' }] }),
    ).rejects.toThrow(TutorValidationError);

    await expect(crear({ ...DATOS_VALIDOS, pacientes: [{ nombre: 'Firulais' }] })).resolves.toBe(1);
  });

  it('AC13: un paciente nuevo siempre se manda como activo=true, sin importar lo que venga en el body', async () => {
    await crear({ ...DATOS_VALIDOS, pacientes: [{ nombre: 'Firulais', activo: false }] });
    expect(repository.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        pacientes: [expect.objectContaining({ nombre: 'Firulais', activo: true })],
      }),
    );
  });
});

describe('tutores.service.editar (US-156 AC15-AC21)', () => {
  const DATOS_VALIDOS = {
    id: '1',
    nombre: 'Juan Pérez',
    telefono: '55-5123-4567',
    correo: 'juan@correo.com',
    pacientes: [],
    usuarioId: 99,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByTelefono.mockResolvedValue(undefined);
    repository.editar.mockResolvedValue(undefined);
  });

  it('actualiza el propietario cuando no hay colisión de teléfono', async () => {
    const id = await editar(DATOS_VALIDOS);
    expect(id).toBe(1);
    // Ajuste posterior (pedido del usuario): se guarda sin guiones.
    expect(repository.editar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, nombre: 'Juan Pérez', telefono: '5551234567' }),
    );
  });

  it('findByTelefono excluye al propio registro que se está editando', async () => {
    await editar(DATOS_VALIDOS);
    expect(repository.findByTelefono).toHaveBeenCalledWith('5551234567', 1);
  });

  it('AC5/AC21: teléfono de OTRO propietario activo se rechaza', async () => {
    repository.findByTelefono.mockResolvedValue({ id: 5, telefono: '5551234567', activo: true });
    await expect(editar(DATOS_VALIDOS)).rejects.toThrow(TutorValidationError);
    expect(repository.editar).not.toHaveBeenCalled();
  });

  it('a diferencia de crear(), editar() NUNCA reactiva — un teléfono de otro propietario INACTIVO también se rechaza, sin pedir confirmación (mismo criterio que areas.service.js#editar)', async () => {
    repository.findByTelefono.mockResolvedValue({ id: 5, telefono: '5551234567', activo: false });
    await expect(editar(DATOS_VALIDOS)).rejects.toThrow(TutorValidationError);
    expect(repository.reactivar).not.toHaveBeenCalled();
    expect(repository.editar).not.toHaveBeenCalled();
  });

  it('AC15: editar sin modificar el propio teléfono no lo considera un duplicado consigo mismo', async () => {
    repository.findByTelefono.mockResolvedValue(undefined); // excludeId ya lo filtra
    await expect(editar(DATOS_VALIDOS)).resolves.toBe(1);
  });

  it('AC16/17/19: pacientes existentes viajan con su id y su `activo` tal cual lo mande el cliente (baja/reactivar)', async () => {
    await editar({
      ...DATOS_VALIDOS,
      pacientes: [{ id: 10, nombre: 'Firulais', tipo: 'Perro', raza: 'Labrador', activo: false }],
    });
    expect(repository.editar).toHaveBeenCalledWith(
      expect.objectContaining({
        pacientes: [expect.objectContaining({ id: 10, activo: false })],
      }),
    );
  });

  it('AC15: un paciente nuevo (sin id) dentro de una edición se manda activo=true', async () => {
    await editar({ ...DATOS_VALIDOS, pacientes: [{ nombre: 'Michi', activo: false }] });
    expect(repository.editar).toHaveBeenCalledWith(
      expect.objectContaining({
        pacientes: [expect.objectContaining({ id: null, activo: true })],
      }),
    );
  });
});

// Pedido del usuario, ajustado tras la primera versión: búsqueda
// incremental sin mínimo de caracteres — "si no tiene nada, salen todos
// los usuarios" — y solo propietarios ACTIVOS (el filtro real vive en el
// repository, ver tutores.repository.js#searchByTelefono; el service solo
// recorta espacios y aplica el límite de resultados).
describe('tutores.service.buscarPorTelefono (pedido del usuario: búsqueda en vivo en el alta)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin texto, igual consulta el repository (para mostrar los primeros propietarios)', async () => {
    repository.searchByTelefono.mockResolvedValue([TUTOR]);
    const result = await buscarPorTelefono('');
    // Ajuste posterior (pedido del usuario): lo que devuelve el repository
    // ya viene sin guiones (TUTOR.telefono); el service lo reformatea a
    // NN-NNNN-NNNN solo para mostrarlo en el combobox.
    expect(result).toEqual([{ ...TUTOR, telefono: '55-5123-4567' }]);
    expect(repository.searchByTelefono).toHaveBeenCalledWith('', 8);
  });

  it('un q ausente (undefined) se trata igual que vacío, no truena', async () => {
    repository.searchByTelefono.mockResolvedValue([]);
    await buscarPorTelefono(undefined);
    expect(repository.searchByTelefono).toHaveBeenCalledWith('', 8);
  });

  it('recorta espacios antes de consultar', async () => {
    repository.searchByTelefono.mockResolvedValue([]);
    await buscarPorTelefono('  555  ');
    expect(repository.searchByTelefono).toHaveBeenCalledWith('555', 8);
  });

  it('con texto, consulta el repository con un límite de resultados', async () => {
    repository.searchByTelefono.mockResolvedValue([TUTOR]);
    const result = await buscarPorTelefono('555');
    expect(result).toEqual([{ ...TUTOR, telefono: '55-5123-4567' }]);
    expect(repository.searchByTelefono).toHaveBeenCalledWith('555', 8);
  });

  // Ajuste posterior, pedido explícito del usuario: buscar sin guiones
  // ("5551234567") o con ellos ("55-5123-4567") debe dar el mismo
  // resultado — el service siempre le manda al repository solo los
  // dígitos de lo que se escribió.
  it('quita los guiones de lo escrito antes de consultar al repository', async () => {
    repository.searchByTelefono.mockResolvedValue([]);
    await buscarPorTelefono('55-5123-4567');
    expect(repository.searchByTelefono).toHaveBeenCalledWith('5551234567', 8);
  });
});

// Ajuste posterior (pedido del usuario): chequeo EXACTO del teléfono al
// salir del campo en el alta — a diferencia de buscarPorTelefono() (parcial,
// solo activos), este SÍ revela un propietario inactivo con su información
// completa (correo/pacientes), porque es el punto de entrada real de la
// reactivación.
describe('tutores.service.verificarTelefono (ajuste posterior: chequeo exacto en blur)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin coincidencia, devuelve existe:false y no consulta mascotas', async () => {
    repository.findByTelefono.mockResolvedValue(undefined);
    const result = await verificarTelefono('55-9999-0000');
    expect(result).toEqual({ existe: false });
    expect(repository.findMascotasByPropietarioId).not.toHaveBeenCalled();
  });

  it('coincide con un propietario ACTIVO: solo trae id/nombre, sin correo ni mascotas', async () => {
    repository.findByTelefono.mockResolvedValue({ ...TUTOR, activo: true });
    const result = await verificarTelefono(TUTOR.telefono);
    expect(result).toEqual({
      existe: true,
      activo: true,
      tutor: { id: TUTOR.id, nombre: TUTOR.nombre },
    });
    expect(repository.findMascotasByPropietarioId).not.toHaveBeenCalled();
  });

  it('coincide con un propietario INACTIVO: trae nombre/teléfono/correo y todas sus mascotas', async () => {
    repository.findByTelefono.mockResolvedValue({ ...TUTOR, activo: false });
    repository.findMascotasByPropietarioId.mockResolvedValue([MASCOTA_A, MASCOTA_B]);
    const result = await verificarTelefono(TUTOR.telefono);
    expect(result).toEqual({
      existe: true,
      activo: false,
      tutor: {
        id: TUTOR.id,
        nombre: TUTOR.nombre,
        // Ajuste posterior (pedido del usuario): TUTOR.telefono (lo que
        // "guarda" el repository mockeado) ya no trae guiones; el service
        // lo reformatea a NN-NNNN-NNNN solo para el modal de reactivar.
        telefono: '55-5123-4567',
        correo: TUTOR.correo,
        pacientes: [MASCOTA_A, MASCOTA_B],
      },
    });
    expect(repository.findMascotasByPropietarioId).toHaveBeenCalledWith(TUTOR.id);
  });

  // Ajuste posterior, pedido explícito del usuario: buscar sin guiones o
  // con ellos debe encontrar lo mismo — verificarTelefono siempre le manda
  // al repository solo los dígitos de lo que se escribió.
  it('quita los guiones de lo escrito antes de consultar al repository', async () => {
    repository.findByTelefono.mockResolvedValue(undefined);
    await verificarTelefono('55-5123-4567');
    expect(repository.findByTelefono).toHaveBeenCalledWith('5551234567');
  });

  it('un valor vacío/indefinido no truena, simplemente no encuentra nada', async () => {
    repository.findByTelefono.mockResolvedValue(undefined);
    const result = await verificarTelefono(undefined);
    expect(result).toEqual({ existe: false });
    expect(repository.findByTelefono).toHaveBeenCalledWith('');
  });
});
