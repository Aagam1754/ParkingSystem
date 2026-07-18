import { normalizePlate } from './plates.js';

const CONFUSABLES = [
  ['0', 'O'],
  ['O', '0'],
  ['1', 'I'],
  ['I', '1'],
  ['5', 'S'],
  ['S', '5'],
  ['8', 'B'],
  ['B', '8'],
  ['G', '6'],
  ['6', 'G'],
];

function variants(plate) {
  const base = normalizePlate(plate);
  const out = new Set([base]);
  for (let i = 0; i < base.length; i += 1) {
    for (const [a, b] of CONFUSABLES) {
      if (base[i] === a) {
        out.add(`${base.slice(0, i)}${b}${base.slice(i + 1)}`);
      }
    }
  }
  return [...out];
}

export function bestRegisteredMatch(rawPlate, registeredPlates) {
  const cand = variants(rawPlate);
  for (const plate of registeredPlates) {
    const norm = normalizePlate(plate);
    if (cand.includes(norm)) return norm;
  }
  // edit distance 1 fallback
  for (const plate of registeredPlates) {
    const norm = normalizePlate(plate);
    if (Math.abs(norm.length - normalizePlate(rawPlate).length) > 1) continue;
    let diff = 0;
    const a = normalizePlate(rawPlate);
    const b = norm;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if (a[i] !== b[i]) diff += 1;
      if (diff > 1) break;
    }
    if (diff <= 1) return norm;
  }
  return normalizePlate(rawPlate);
}
