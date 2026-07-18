/** Compact plate → display form, e.g. GJ01YK1001 → "GJ01YK 1001" */
export function formatPlate(plate) {
  const raw = String(plate || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!raw) return '';
  // Typical Indian private plate: 2 letters + 1–2 digits + 1–3 letters + 4 digits
  const m = raw.match(/^([A-Z]{2}\d{1,2}[A-Z]{1,3})(\d{4})$/);
  if (m) return `${m[1]} ${m[2]}`;
  // Fallback: space before last 4 when long enough
  if (raw.length >= 8) return `${raw.slice(0, -4)} ${raw.slice(-4)}`;
  return raw;
}
