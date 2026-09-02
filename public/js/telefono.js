// Extraído de 4 vistas que lo repetían byte-por-byte (refactor de bajo
// riesgo, sin cambio de comportamiento) — máscara depende del prefijo:
// 55/56 (CDMX/Edomex, lada de 2 dígitos) usa NN-NNNN-NNNN; cualquier otro
// prefijo usa NNN-NNN-NNNN (lada de 3 dígitos).
function formatearTelefono(digitos) {
  const esCDMXEdomex = digitos.slice(0, 2) === '55' || digitos.slice(0, 2) === '56';
  const grupos = esCDMXEdomex
    ? [digitos.slice(0, 2), digitos.slice(2, 6), digitos.slice(6, 10)]
    : [digitos.slice(0, 3), digitos.slice(3, 6), digitos.slice(6, 10)];
  return grupos.filter((parte) => parte).join('-');
}
