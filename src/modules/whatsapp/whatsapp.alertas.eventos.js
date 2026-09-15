// Bus SSE en memoria para el monolito actual. Los eventos no llevan datos
// de la alerta: únicamente indican que cada cliente autenticado debe volver
// a consultar su lista autorizada en PostgreSQL.
const clientes = new Set();

function suscribir(res) {
  clientes.add(res);
  res.write('event: actualizar\ndata: {}\n\n');
  return () => clientes.delete(res);
}

function publicarActualizacion() {
  for (const res of clientes) {
    if (!res.destroyed && !res.writableEnded) {
      res.write('event: actualizar\ndata: {}\n\n');
    }
  }
}

function totalClientes() {
  return clientes.size;
}

module.exports = { suscribir, publicarActualizacion, totalClientes };
