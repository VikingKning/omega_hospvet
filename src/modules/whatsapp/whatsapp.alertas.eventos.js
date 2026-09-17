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
