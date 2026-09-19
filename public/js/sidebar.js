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

// US WA 018: bandeja global de alertas. sidebar.js ya está presente en
// todas las pantallas autenticadas, por lo que este componente permanece
// disponible aunque el usuario navegue entre módulos. PostgreSQL conserva
// la fuente de verdad; SSE/BroadcastChannel solo aceleran la actualización.
(() => {
  const API = '/api/whatsapp/alertas';
  const tabId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const canal = 'BroadcastChannel' in globalThis
    ? new BroadcastChannel('omega-whatsapp-alertas')
    : null;
  let csrfToken = '';
  let alertasActuales = [];
  let actualizando = false;

  const contenedor = document.createElement('aside');
  contenedor.className = 'whatsapp-alertas';
  contenedor.setAttribute('aria-live', 'assertive');
  contenedor.hidden = true;
  contenedor.innerHTML = `
    <div class="whatsapp-alertas-header">
      <div>
        <strong>Alertas de WhatsApp</strong>
        <span id="whatsappAlertasConteo"></span>
      </div>
      <button type="button" class="whatsapp-alertas-permiso" id="whatsappAlertasPermiso" hidden>
        Activar notificaciones
      </button>
    </div>
    <div class="whatsapp-alertas-error" id="whatsappAlertasError" hidden></div>
    <div class="whatsapp-alertas-lista" id="whatsappAlertasLista"></div>`;
  document.body.append(contenedor);

  const lista = document.getElementById('whatsappAlertasLista');
  const conteo = document.getElementById('whatsappAlertasConteo');
  const botonPermiso = document.getElementById('whatsappAlertasPermiso');
  const errorBox = document.getElementById('whatsappAlertasError');

  function mostrarError(mensaje) {
    errorBox.textContent = mensaje;
    errorBox.hidden = !mensaje;
  }

  function claveLocal(prefijo, alertaId) {
    return `omega-wa-alerta:${prefijo}:${alertaId}`;
  }

  async function registrarCanal(alertaId, estado, error) {
    if (!csrfToken) return;
    try {
      await fetch(`${API}/${alertaId}/navegador`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ estado, error }),
      });
    } catch {
      // El portal sigue mostrando la alerta. Este canal es complementario.
    }
  }

  async function mostrarNotificacionUnaVez(alerta) {
    const claveMostrada = claveLocal('notificada', alerta.id);
    if (!('Notification' in globalThis) || Notification.permission !== 'granted') {
      const claveReportada = claveLocal('navegador-no-disponible', alerta.id);
      if (!localStorage.getItem(claveReportada)) {
        localStorage.setItem(claveReportada, tabId);
        await registrarCanal(alerta.id, 'no_disponible', 'Permiso no concedido o canal no soportado.');
      }
      return;
    }

    const mostrar = async () => {
      if (localStorage.getItem(claveMostrada)) return;
      localStorage.setItem(claveMostrada, tabId);
      try {
        const notificacion = new Notification(alerta.titulo, {
          body: `${alerta.mensaje}${alerta.telefonoExterno ? ` Teléfono: ${alerta.telefonoExterno}` : ''}`,
          tag: `omega-wa-alerta-${alerta.id}`,
        });
        notificacion.onclick = () => globalThis.focus();
        await registrarCanal(alerta.id, 'enviado');
        canal?.postMessage({ tipo: 'notificada', alertaId: alerta.id });
      } catch (err) {
        localStorage.removeItem(claveMostrada);
        await registrarCanal(alerta.id, 'fallido', err.message);
      }
    };

    if (navigator.locks?.request) {
      await navigator.locks.request(
        `omega-wa-alerta-notificacion-${alerta.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (lock) await mostrar();
        },
      );
    } else {
      await mostrar();
    }
  }

  async function atender(alertaId, boton) {
    boton.disabled = true;
    mostrarError('');
    try {
      const respuesta = await fetch(`${API}/${alertaId}/atender`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: '{}',
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo atender la alerta.');
      canal?.postMessage({ tipo: 'actualizar' });
      await refrescar();
    } catch (err) {
      mostrarError(err.message);
      boton.disabled = false;
      await refrescar();
    }
  }

  function renderizar(alertas) {
    alertasActuales = alertas;
    lista.replaceChildren();
    contenedor.hidden = alertas.length === 0;
    conteo.textContent = alertas.length ? `(${alertas.length})` : '';
    botonPermiso.hidden =
      !('Notification' in globalThis) || Notification.permission !== 'default' || !alertas.length;

    for (const alerta of alertas) {
      const tarjeta = document.createElement('article');
      tarjeta.className = `whatsapp-alerta whatsapp-alerta-${alerta.tipo}`;
      const encabezado = document.createElement('div');
      encabezado.className = 'whatsapp-alerta-encabezado';
      const titulo = document.createElement('strong');
      titulo.textContent = alerta.titulo;
      const fecha = document.createElement('time');
      fecha.dateTime = alerta.creadaEn;
      fecha.textContent = new Date(alerta.creadaEn).toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
      });
      encabezado.append(titulo, fecha);

      const mensaje = document.createElement('p');
      mensaje.textContent = alerta.mensaje;
      const referencia = document.createElement('small');
      referencia.textContent = alerta.telefonoExterno
        ? `Tutor: ${alerta.telefonoExterno}`
        : `Conversación #${alerta.conversacionId}`;
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'whatsapp-alerta-atender';
      boton.textContent = 'Atender';
      boton.addEventListener('click', () => atender(alerta.id, boton));
      tarjeta.append(encabezado, mensaje, referencia, boton);
      lista.append(tarjeta);
    }
  }

  async function refrescar() {
    if (actualizando) return;
    actualizando = true;
    try {
      const respuesta = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!respuesta.ok) throw new Error('No se pudieron consultar las alertas.');
      const cuerpo = await respuesta.json();
      csrfToken = cuerpo.csrfToken;
      renderizar(cuerpo.alertas ?? []);
      await Promise.all((cuerpo.alertas ?? []).map(mostrarNotificacionUnaVez));
      mostrarError('');
    } catch (err) {
      mostrarError(err.message);
    } finally {
      actualizando = false;
    }
  }

  botonPermiso.addEventListener('click', async () => {
    const permiso = await Notification.requestPermission();
    botonPermiso.hidden = permiso !== 'default';
    if (permiso === 'granted') {
      await Promise.all(alertasActuales.map(mostrarNotificacionUnaVez));
    } else {
      await Promise.all(
        alertasActuales.map((alerta) =>
          registrarCanal(alerta.id, 'no_disponible', 'El usuario rechazó el permiso.'),
        ),
      );
    }
  });

  canal?.addEventListener('message', (evento) => {
    if (evento.data?.tipo === 'actualizar') refrescar();
  });

  const stream = new EventSource(`${API}/eventos`);
  stream.addEventListener('actualizar', refrescar);
  setInterval(refrescar, 15_000);
  refrescar();
})();
