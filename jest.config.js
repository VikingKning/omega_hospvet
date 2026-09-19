module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  // Tope bajo por default — sin esto, Jest usa (núcleos - 1) workers, y
  // cada test de integración levanta su propio pool de Postgres (hasta 10
  // conexiones, ver src/config/database.js) además de una instancia
  // completa de la app Express. Con muchas suites de integración reales
  // (no mockeadas), eso escala rápido y puede saturar la memoria de una
  // máquina de desarrollo — pedido explícito del usuario tras una corrida
  // completa que colgó su equipo. 2 es conservador a propósito; usar
  // `--maxWorkers` en el comando puntual si de verdad hace falta más.
  maxWorkers: 2,
};
