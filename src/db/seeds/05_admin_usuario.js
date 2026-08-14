const bcrypt = require('bcrypt');

exports.seed = async function seed(knex) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const nombre = process.env.ADMIN_NOMBRE || 'Administrador';
  const apellidos = process.env.ADMIN_APELLIDOS || 'Omega';
  const correo = process.env.ADMIN_EMAIL || 'admin@omegavet.local';
  const password = process.env.ADMIN_PASSWORD;
  const ahora = knex.fn.now();

  let admin = await knex('usuarios').where({ username }).first('id');

  if (!admin) {
    if (!password) {
      throw new Error(
        'Falta ADMIN_PASSWORD en el .env para poder crear el usuario administrador de arranque.',
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    [admin] = await knex('usuarios')
      .insert({
        nombre,
        apellidos,
        correo,
        username,
        password_hash: passwordHash,
        estatus: 'activo',
        creado_por: null,
        creado_en: ahora,
      })
      .returning(['id']);
  }

  // Se re-sincroniza SIEMPRE, no solo al crear: 01_permissions.js borra
  // usuario_permisos cada vez que refresca el catálogo (por ejemplo, al
  // renombrar o agregar un permiso), y sin esto el admin de arranque se
  // quedaría silenciosamente sin acceso después de un `seed:run` normal en
  // una base que ya tenía usuarios.
  const permisos = await knex('permissions').select('id');
  await knex('usuario_permisos').where({ usuario_id: admin.id }).del();
  await knex('usuario_permisos').insert(
    permisos.map((p) => ({
      usuario_id: admin.id,
      permission_id: p.id,
      otorgado_por: admin.id,
      otorgado_en: ahora,
    })),
  );
};
