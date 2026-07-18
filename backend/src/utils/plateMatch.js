import { normalizePlate } from './plates.js';

const CONFUSABLES = {
  0: 'O',
  O: '0',
  1: 'I',
  I: '1',
  5: 'S',
  S: '5',
  8: 'B',
  B: '8',
  6: 'G',
  G: '6',
  2: 'Z',
  Z: '2',
};

function normalizeLoose(text) {
  return normalizePlate(text).replace(/[^A-Z0-9]/g, '');
}

function confuseEqual(a, b) {
  if (a === b) return true;
  return CONFUSABLES[a] === b || CONFUSABLES[b] === a;
}

/** Strict near-equal: same length, at most 1 confusable/typo. */
function nearEqual(a, b, maxDiff = 1) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!confuseEqual(a[i], b[i])) {
      diff += 1;
      if (diff > maxDiff) return false;
    }
  }
  return true;
}

/** Strict Indian private/commercial plate shape, e.g. GJ01YK1001 */
export function isStrictIndianPlate(plate) {
  const p = normalizeLoose(plate);
  return /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/.test(p);
}

/**
 * Find registered plate from OCR — exact / 1-char only.
 * No sliding-window fuzzy (that caused phantom check-ins on empty camera).
 */
export function resolvePlateFromOcr({ plate, candidates = [], rawText = '' }, registeredPlates) {
  const known = registeredPlates.map(normalizePlate).filter(Boolean);
  const blob = normalizeLoose([plate, ...candidates, rawText].filter(Boolean).join(''));
  const tryList = [plate, ...candidates].map(normalizeLoose).filter(Boolean);

  // 1) exact candidate match
  for (const cand of tryList) {
    for (const k of known) {
      if (cand === k) {
        return { plate: k, matched: true, method: 'exact' };
      }
    }
  }

  // 2) full registered plate appears as contiguous substring in OCR blob
  for (const k of known) {
    if (k.length >= 8 && blob.includes(k)) {
      return { plate: k, matched: true, method: 'substring' };
    }
  }

  // 3) near-equal full candidate (1 char / confusable only), same length
  for (const cand of tryList) {
    for (const k of known) {
      if (nearEqual(cand, k, 1)) {
        return { plate: k, matched: true, method: 'near' };
      }
    }
  }

  const fallback = normalizePlate(plate || tryList[0] || '');
  return { plate: fallback || null, matched: false, method: 'none' };
}

export function bestRegisteredMatch(rawPlate, registeredPlates) {
  const resolved = resolvePlateFromOcr({ plate: rawPlate }, registeredPlates);
  return resolved.matched ? resolved.plate : normalizePlate(rawPlate);
}
