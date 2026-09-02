// Los 11 colores de EVENTO que la API de Google Calendar acepta como
// `colorId` (endpoint `colors().get().event`, no los de calendario — son
// dos catálogos distintos). Lista y hex fijos de Google, no configurables
// por el cliente; el nombre en español es el mismo que muestra el selector
// de color nativo de Google Calendar. Se guarda solo el `id` (string '1'..
// '11') en `areas.color_google_calendar` — el hex de aquí es nada más para
// pintar el swatch en este UI. `foreground` es el mismo `#1d1d1d` que usa
// Google para TODOS sus colores de evento (nunca blanco) — son fondos
// pastel/claros incluso los "oscuros" (Tomate, Arándano), texto blanco
// encima no pasa contraste mínimo. Se usa donde el texto va ENCIMA del
// color (eventos del calendario), no en los swatches del picker (ahí el
// nombre vive debajo, no sobre el color).
const GOOGLE_CALENDAR_COLORS = [
  { id: '1', nombre: 'Lavanda', hex: '#a4bdfc', foreground: '#1d1d1d' },
  { id: '2', nombre: 'Salvia', hex: '#7ae7bf', foreground: '#1d1d1d' },
  { id: '3', nombre: 'Uva', hex: '#dbadff', foreground: '#1d1d1d' },
  { id: '4', nombre: 'Flamenco', hex: '#ff887c', foreground: '#1d1d1d' },
  { id: '5', nombre: 'Plátano', hex: '#fbd75b', foreground: '#1d1d1d' },
  { id: '6', nombre: 'Mandarina', hex: '#ffb878', foreground: '#1d1d1d' },
  { id: '7', nombre: 'Pavo real', hex: '#46d6db', foreground: '#1d1d1d' },
  { id: '8', nombre: 'Grafito', hex: '#e1e1e1', foreground: '#1d1d1d' },
  { id: '9', nombre: 'Arándano', hex: '#5484ed', foreground: '#1d1d1d' },
  { id: '10', nombre: 'Albahaca', hex: '#51b749', foreground: '#1d1d1d' },
  { id: '11', nombre: 'Tomate', hex: '#dc2127', foreground: '#1d1d1d' },
];

// Pseudo-color: el área no tiene un colorId propio asignado todavía (se
// guarda como NULL en `areas.color_google_calendar`, no como un string
// vacío) — es el valor por defecto del picker (pedido explícito del
// usuario), no un estado de error. `hex: null` porque no pinta ningún
// swatch de color real, solo el ícono de "sin color".
const SIN_COLOR = { id: null, nombre: 'Sin color', hex: null, foreground: null };

const VALID_IDS = new Set(GOOGLE_CALENDAR_COLORS.map((c) => c.id));

function isValidColorId(id) {
  return VALID_IDS.has(String(id));
}

// null/undefined/'' (el hidden input del picker manda '' cuando el
// usuario elige "Sin color") resuelven al mismo pseudo-color.
function findColor(id) {
  if (id === null || id === undefined || id === '') return SIN_COLOR;
  return GOOGLE_CALENDAR_COLORS.find((c) => c.id === String(id)) ?? SIN_COLOR;
}

module.exports = { GOOGLE_CALENDAR_COLORS, isValidColorId, findColor };
