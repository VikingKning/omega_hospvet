// Loader global de bloqueo (partials/global-loader.ejs) — mismo patrón que
// confirmModal.js: funciones de nivel superior en un <script> normal (no
// módulo), así quedan disponibles como globales para el resto de scripts
// inline de la vista sin necesidad de exportarlas explícitamente. Requiere
// que la vista incluya el markup de #globalLoaderBackdrop.
const globalLoaderBackdrop = document.getElementById('globalLoaderBackdrop');
const globalLoaderText = document.getElementById('globalLoaderText');

function mostrarLoaderGlobal(texto) {
  if (!globalLoaderBackdrop) return;
  if (texto) globalLoaderText.textContent = texto;
  globalLoaderBackdrop.classList.add('open');
}

function ocultarLoaderGlobal() {
  globalLoaderBackdrop?.classList.remove('open');
}
