const bcrypt = require('bcrypt');

exports.seed = async function seed(knex) {
  const yaExisteAdmin = await knex('usuarios').first('id');
  if (yaExisteAdmin) return;

  const nombre = process.env.ADMIN_NOMBRE || 'Administrador';
  const apellidos = process.env.ADMIN_APELLIDOS || 'Omega';
  const correo = process.env.ADMIN_EMAIL || 'admin@omegavet.local';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      'Falta ADMIN_PASSWORD en el .env para poder crear el usuario administrador de arranque.',
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const ahora = knex.fn.now();

  const [admin] = await knex('usuarios')
    .insert({
      nombre,
      apellidos,
      correo,
      username,
      password_hash: passwordHash,
      activo: true,
      creado_por: null,
      creado_en: ahora,
    })
    .returning(['id']);

  const permisos = await knex('permissions').select('id');

  await knex('usuario_permisos').insert(
    permisos.map((p) => ({
      usuario_id: admin.id,
      permission_id: p.id,
      otorgado_por: admin.id,
      otorgado_en: ahora,
    })),
  );
};
