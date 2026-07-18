import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { query, withTransaction } from '../db/pool.js';
import { processEntryScan, processExitScan } from '../services/allotment.js';
import { bestRegisteredMatch } from '../utils/plateMatch.js';

const router = Router();
const PYTHON_ALPR_URL = process.env.PYTHON_ALPR_URL || 'http://127.0.0.1:5001';

function emitLive(req, payload) {
  req.app.get('io')?.emit('occupancy.updated', { at: new Date().toISOString() });
  req.app.get('io')?.emit('session.updated', payload);
}

/**
 * Proxy webcam/image frame to Python OCR service.
 * Body: multipart image OR JSON { imageBase64 }
 */
router.post(
  '/scan',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const payload = req.body || {};
      const response = await fetch(`${PYTHON_ALPR_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: payload.imageBase64,
          hint: payload.hint || null,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({
          error: data.error || 'Python ALPR failed',
          detail: data,
        });
      }
      if (data.plate) {
        const registered = await query(
          `SELECT plate_normalized FROM vehicles WHERE status = 'ACTIVE' AND deleted_at IS NULL`
        );
        const corrected = bestRegisteredMatch(
          data.plate,
          registered.map((r) => r.plate_normalized)
        );
        if (corrected && corrected !== data.plate) {
          data.rawPlate = data.plate;
          data.plate = corrected;
          data.message = `Corrected OCR ${data.rawPlate} → ${corrected}`;
        }
      }
      return res.json(data);
    } catch (err) {
      console.error(err);
      return res.status(503).json({
        error: 'ALPR service unavailable. Is the Python scanner running on :5001?',
      });
    }
  }
);

/**
 * Scan plate via Python (optional image) then check-in / allot slot.
 */
router.post(
  '/check-in',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const body = req.body || {};
      let plate = body.plate;
      let confidence = Number(body.confidence ?? 0.9);
      let ocr = null;

      if (!plate && body.imageBase64) {
        const response = await fetch(`${PYTHON_ALPR_URL}/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: body.imageBase64 }),
        });
        ocr = await response.json().catch(() => ({}));
        if (!response.ok || !ocr.plate) {
          return res.status(422).json({
            error: ocr.error || 'Could not read number plate from camera frame',
            ocr,
          });
        }
        plate = ocr.plate;
        confidence = Number(ocr.confidence ?? confidence);
      }

      if (!plate) {
        return res.status(400).json({ error: 'plate or imageBase64 is required' });
      }

      // Fuzzy-correct OCR near-misses against registered plates (try all candidates)
      const registered = await query(
        `SELECT plate_normalized FROM vehicles WHERE status = 'ACTIVE' AND deleted_at IS NULL`
      );
      const known = registered.map((r) => r.plate_normalized);
      const tryList = [plate, ...(ocr?.candidates || [])];
      let corrected = null;
      for (const candidate of tryList) {
        const match = bestRegisteredMatch(candidate, known);
        if (known.includes(match)) {
          corrected = match;
          break;
        }
      }
      if (corrected && corrected !== String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '')) {
        ocr = { ...(ocr || {}), rawPlate: plate, correctedPlate: corrected };
        plate = corrected;
      }

      const result = await withTransaction((conn) =>
        processEntryScan(conn, {
          plate,
          vehicleType: body.vehicleType || ocr?.vehicleTypeHint || 'CAR',
          confidence,
          baseId: body.baseId,
          source: body.source || 'WEBCAM',
          idempotencyKey: body.idempotencyKey,
        })
      );

      emitLive(req, result);
      return res.status(result.allotted ? 201 : 409).json({ ...result, ocr });
    } catch (err) {
      console.error(err);
      return res.status(err.status || 500).json({ error: err.message || 'Check-in failed' });
    }
  }
);

router.post(
  '/check-out',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const result = await withTransaction((conn) =>
        processExitScan(conn, {
          plate: req.body?.plate,
          confidence: req.body?.confidence,
          source: req.body?.source || 'WEBCAM',
        })
      );
      emitLive(req, result);
      return res.json(result);
    } catch (err) {
      console.error(err);
      return res.status(err.status || 500).json({ error: err.message || 'Check-out failed' });
    }
  }
);

export default router;
