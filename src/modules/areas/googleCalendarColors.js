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

const SIN_COLOR = { id: null, nombre: 'Sin color', hex: null, foreground: null };

const VALID_IDS = new Set(GOOGLE_CALENDAR_COLORS.map((c) => c.id));

function isValidColorId(id) {
  return VALID_IDS.has(String(id));
}

function findColor(id) {
  if (id === null || id === undefined || id === '') return SIN_COLOR;
  return GOOGLE_CALENDAR_COLORS.find((c) => c.id === String(id)) ?? SIN_COLOR;
}

module.exports = { GOOGLE_CALENDAR_COLORS, isValidColorId, findColor };
