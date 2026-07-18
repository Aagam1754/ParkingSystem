import { isStrictIndianPlate } from './plateMatch.js';

/** Decide if a webcam OCR result is safe to act on (check-in / check-out). */
export function acceptWebcamPlate(ocr) {
  if (!ocr?.plate) {
    return { ok: false, reason: 'No plate read from camera' };
  }
  if (ocr.matchedRegistered) {
    return { ok: true, plate: ocr.plate, mode: 'registered' };
  }
  // Guest only with a strict real-looking Indian plate (not OCR gibberish)
  if (isStrictIndianPlate(ocr.plate) && Number(ocr.confidence || 0) >= 0.85) {
    return { ok: true, plate: ocr.plate, mode: 'guest' };
  }
  return {
    ok: false,
    reason: 'No clear number plate yet — hold a real plate in the yellow box',
  };
}
