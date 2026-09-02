// Extraído de 7 vistas que lo repetían casi byte-por-byte (refactor de
// bajo riesgo, sin cambio de comportamiento) — modal de confirmación en
// vez del confirm() nativo del navegador, patrón documentado por HTMX
// (evento htmx:confirm + evt.detail.issueRequest). Solo se intercepta
// cuando el elemento que disparó la petición trae hx-confirm — así los
// demás triggers de cada vista (buscar, ordenar, paginar) siguen sin pedir
// confirmación. Requiere que la vista incluya el markup de
// #confirmModalBackdrop (mismo id en las 7 vistas).
const confirmModalBackdrop = document.getElementById('confirmModalBackdrop');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalConfirmBtn = document.getElementById('confirmModalConfirm');
// El texto que cada vista ya trae en su propio HTML ("Dar de baja" en la
// mayoría, "Eliminar" en laboratorio.ejs, "Cancelar cita" en agenda.ejs) —
// capturado una sola vez al cargar, ANTES de que openConfirmModal pueda
// sobreescribirlo.
const defaultConfirmLabel = confirmModalConfirmBtn.textContent;
let resolveConfirm = null;

// `confirmLabel` es opcional — cuando no se manda, el botón vuelve al
// texto por default de esta vista (capturado arriba), nunca se queda
// "pegado" al último label custom que se haya mostrado. Solo usuarios.ejs
// pasa un `confirmLabel` real (US-605: "Resetear contraseña" reusa este
// mismo modal, donde "Dar de baja" sería incorrecto).
function openConfirmModal(message, confirmLabel) {
  confirmModalMessage.textContent = message;
  confirmModalConfirmBtn.textContent = confirmLabel || defaultConfirmLabel;
  confirmModalBackdrop.classList.add('open');
  return new Promise((resolve) => {
    resolveConfirm = resolve;
  });
}

function closeConfirmModal(result) {
  confirmModalBackdrop.classList.remove('open');
  resolveConfirm?.(result);
  resolveConfirm = null;
}

document
  .getElementById('confirmModalCancel')
  .addEventListener('click', () => closeConfirmModal(false));
document
  .getElementById('confirmModalClose')
  .addEventListener('click', () => closeConfirmModal(false));
confirmModalConfirmBtn.addEventListener('click', () => closeConfirmModal(true));
confirmModalBackdrop.addEventListener('click', (event) => {
  if (event.target === confirmModalBackdrop) closeConfirmModal(false);
});

document.body.addEventListener('htmx:confirm', (event) => {
  if (!event.target.hasAttribute('hx-confirm')) return;
  event.preventDefault();
  openConfirmModal(event.detail.question, event.target.dataset.confirmLabel).then((confirmed) => {
    if (confirmed) event.detail.issueRequest(true);
  });
});
