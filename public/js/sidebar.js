// Extraído de 11 vistas que lo repetían byte-por-byte (refactor de bajo
// riesgo, sin cambio de comportamiento) — abre/cierra el sidebar en mobile
// y expande/colapsa los submenús del menú principal. Cargado vía
// `<script src="/js/sidebar.js">` en vez de nonce inline porque `'self'`
// ya está permitido en script-src (helmet, ver src/app.js) sin necesitar
// nonce para archivos same-origin.
const sidebar = document.getElementById('sidebar');
const app = document.querySelector('.app');
const sidebarToggle = document.getElementById('sidebarToggle');
const navBackdrop = document.getElementById('navBackdrop');

sidebarToggle.addEventListener('click', () => {
  app.classList.toggle('sidebar-hidden');
  app.classList.toggle('mobile-menu-open');
});

navBackdrop.addEventListener('click', () => {
  app.classList.remove('sidebar-hidden');
  app.classList.remove('mobile-menu-open');
});

document.querySelectorAll('.nav-toggle').forEach((toggle) => {
  const submenu = document.getElementById(toggle.dataset.target);
  if (submenu.classList.contains('open')) {
    submenu.style.maxHeight = `${submenu.scrollHeight}px`;
  }

  toggle.addEventListener('click', () => {
    const isOpen = submenu.classList.contains('open');

    document.querySelectorAll('.submenu.open').forEach((open) => {
      if (open !== submenu) {
        open.classList.remove('open');
        open.style.maxHeight = null;
        open.previousElementSibling?.classList.remove('active');
      }
    });

    submenu.classList.toggle('open', !isOpen);
    toggle.classList.toggle('active', !isOpen);
    submenu.style.maxHeight = !isOpen ? `${submenu.scrollHeight}px` : null;
  });
});
