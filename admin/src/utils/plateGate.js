import { formatPlate } from './plates';

/** Strict Indian plate for guest auto actions, e.g. GJ01YK1001 */
export function isStrictIndianPlate(plate) {
  const p = String(plate || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/.test(p);
}

/** Only act on registered OCR match or a strict Indian plate. */
export function canActOnScan(scanned) {
  if (!scanned?.plate) return false;
  if (scanned.matchedRegistered) return true;
  if (scanned.engine && String(scanned.engine).includes('known')) return true;
  if (isStrictIndianPlate(scanned.plate) && Number(scanned.confidence || 0) >= 0.85) return true;
  return false;
}

export { formatPlate };
