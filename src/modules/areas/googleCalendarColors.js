// Los 11 colores de EVENTO que la API de Google Calendar acepta como
// `colorId` (endpoint `colors().get().event`, no los de calendario — son
// dos catálogos distintos). Lista y hex fijos de Google, no configurables
// por el cliente; el nombre en español es el mismo que muestra el selector
// de color nativo de Google Calendar. Se guarda solo el `id` (string '1'..
// '11') en `areas.color_google_calendar` — el hex de aquí es nada más para
// pintar el swatch en este UI.
const GOOGLE_CALENDAR_COLORS = [
  { id: '1', nombre: 'Lavanda', hex: '#a4bdfc' },
  { id: '2', nombre: 'Salvia', hex: '#7ae7bf' },
  { id: '3', nombre: 'Uva', hex: '#dbadff' },
  { id: '4', nombre: 'Flamenco', hex: '#ff887c' },
  { id: '5', nombre: 'Plátano', hex: '#fbd75b' },
  { id: '6', nombre: 'Mandarina', hex: '#ffb878' },
  { id: '7', nombre: 'Pavo real', hex: '#46d6db' },
  { id: '8', nombre: 'Grafito', hex: '#e1e1e1' },
  { id: '9', nombre: 'Arándano', hex: '#5484ed' },
  { id: '10', nombre: 'Albahaca', hex: '#51b749' },
  { id: '11', nombre: 'Tomate', hex: '#dc2127' },
];

// Pseudo-color: el área no tiene un colorId propio asignado todavía (se
// guarda como NULL en `areas.color_google_calendar`, no como un string
// vacío) — es el valor por defecto del picker (pedido explícito del
// usuario), no un estado de error. `hex: null` porque no pinta ningún
// swatch de color real, solo el ícono de "sin color".
const SIN_COLOR = { id: null, nombre: 'Sin color', hex: null };

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

module.exports = { GOOGLE_CALENDAR_COLORS, SIN_COLOR, isValidColorId, findColor };
