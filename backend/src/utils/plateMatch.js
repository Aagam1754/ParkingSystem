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

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalizeLoose(text) {
  return normalizePlate(text).replace(/[^A-Z0-9]/g, '');
}

function confuseEqual(a, b) {
  if (a === b) return true;
  return CONFUSABLES[a] === b || CONFUSABLES[b] === a;
}

function fuzzyEquals(a, b, maxDiff = 2) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > maxDiff) return false;
  let diff = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const ca = a[i] || '';
    const cb = b[i] || '';
    if (!confuseEqual(ca, cb)) {
      diff += 1;
      if (diff > maxDiff) return false;
    }
  }
  return true;
}

/** Find best registered plate inside OCR candidates / raw blob. */
export function resolvePlateFromOcr({ plate, candidates = [], rawText = '' }, registeredPlates) {
  const known = registeredPlates.map(normalizePlate).filter(Boolean);
  const blob = normalizeLoose([plate, ...candidates, rawText].filter(Boolean).join(''));
  const tryList = [plate, ...candidates].map(normalizeLoose).filter(Boolean);

  // 1) exact / near exact against candidates
  for (const cand of tryList) {
    for (const k of known) {
      if (fuzzyEquals(cand, k, 1)) {
        return { plate: k, matched: true, method: 'candidate' };
      }
    }
  }

  // 2) registered plate appears as substring in OCR blob (common with noisy OCR)
  for (const k of known) {
    if (blob.includes(k)) {
      return { plate: k, matched: true, method: 'substring' };
    }
    // sliding window fuzzy
    for (let i = 0; i <= Math.max(0, blob.length - k.length); i += 1) {
      const window = blob.slice(i, i + k.length);
      if (fuzzyEquals(window, k, 2)) {
        return { plate: k, matched: true, method: 'window' };
      }
    }
  }

  // 3) edit distance <= 2 against known
  for (const cand of tryList) {
    let best = null;
    let bestDist = 99;
    for (const k of known) {
      const d = editDistance(cand, k);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    if (best && bestDist <= 2) {
      return { plate: best, matched: true, method: 'edit' };
    }
  }

  const fallback = normalizePlate(plate || tryList[0] || '');
  return { plate: fallback || null, matched: false, method: 'none' };
}

export function bestRegisteredMatch(rawPlate, registeredPlates) {
  const resolved = resolvePlateFromOcr({ plate: rawPlate }, registeredPlates);
  return resolved.plate || normalizePlate(rawPlate);
}
