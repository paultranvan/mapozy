export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export function formatCo2(grams: number): string {
  if (grams < 1000) return `${Math.round(grams)} g CO₂`;
  const kg = grams / 1000;
  return `${kg.toFixed(kg < 10 ? 2 : 1)} kg CO₂`;
}

export function formatSpeed(mps: number): string {
  const kmh = mps * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

export function formatTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  return d.toLocaleDateString();
}
