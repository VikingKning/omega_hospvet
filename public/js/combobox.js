// Navegación por teclado + botón "x" para limpiar, compartido por TODOS los
// combobox custom del proyecto (pedido explícito del usuario) — mismo
// criterio que htmx.min.js: un solo <script> vendored, funciones globales,
// sin build step ni ESM. Cada vista sigue dueña de su propia lógica de
// render/selección (criterio ya establecido de módulos independientes);
// esto solo cubre el comportamiento de teclado y el botón de limpiar, que
// es idéntico en los 18 combobox del sistema.

// ArrowDown/ArrowUp mueven un índice sobre los <li class="combobox-item">
// visibles en ese momento (recalculados en cada tecla, nunca cacheados —
// la lista puede haberse vuelto a renderizar entre una tecla y la
// siguiente, ej. mientras se escribe una búsqueda). Enter dispara un click
// SINTÉTICO sobre el item activo en vez de reimplementar la selección: así
// reutiliza el listener de click que cada archivo ya tiene (o el propio
// hx-post/hx-vals de HTMX en los filtros de tabla), sin duplicar lógica de
// negocio aquí. Escape solo cierra, nunca selecciona.
function attachComboboxKeyboardNav(triggerEl, listEl) {
  let activeIndex = -1;
  // La lista se re-renderiza por completo (innerHTML) cada vez que cambia
  // — un índice viejo ya no corresponde a ningún item real después de eso,
  // así que se resetea en cuanto el contenido cambia.
  new MutationObserver(() => {
    activeIndex = -1;
  }).observe(listEl, { childList: true });

  triggerEl.addEventListener('keydown', (event) => {
    if (triggerEl.disabled) return;

    if (listEl.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      listEl.hidden = false;
      return;
    }

    const items = Array.from(listEl.querySelectorAll('.combobox-item'));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex =
        event.key === 'ArrowDown'
          ? Math.min(activeIndex + 1, items.length - 1)
          : Math.max(activeIndex - 1, 0);
      items.forEach((item, i) => item.classList.toggle('active', i === activeIndex));
      items[activeIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !listEl.hidden && items[activeIndex]) {
      event.preventDefault();
      items[activeIndex].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } else if (event.key === 'Escape') {
      listEl.hidden = true;
      activeIndex = -1;
    }
  });
}

// Botón "x" — se inserta dentro de wrapperEl (que ya tiene position:relative
// vía .combobox en main.css), visible solo cuando triggerEl.value no está
// vacío. Regresa una función `refrescar()`: como escribir triggerEl.value
// desde código (selección por click, cascadas de reset de otro campo,
// precarga inicial) NO dispara un evento 'input' solo, cada archivo debe
// llamar a esa función después de cualquier punto donde YA actualiza el
// valor por su cuenta — mismo criterio ya usado en el proyecto para
// actualizarBotonConfirmar()/actualizarEstadosBotonesArchivo() (una función
// de "refrescar estado visual" que se llama explícitamente tras cada cambio
// relevante, en vez de adivinar con timers o MutationObservers frágiles).
function attachComboboxClearButton(wrapperEl, triggerEl, onClear) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'combobox-clear';
  btn.setAttribute('aria-label', 'Limpiar');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  wrapperEl.appendChild(btn);

  function refrescar() {
    // Deshabilitado (ej. Mascota antes de elegir Tutor, o formulario en
    // solo lectura) — nunca mostrar un botón de limpiar sobre un campo que
    // ya de por sí no se puede editar.
    btn.hidden = !triggerEl.value || triggerEl.disabled;
  }
  refrescar();
  triggerEl.addEventListener('input', refrescar);

  btn.addEventListener('click', (event) => {
    event.preventDefault();
    onClear();
    refrescar();
    triggerEl.focus();
  });

  return refrescar;
}
