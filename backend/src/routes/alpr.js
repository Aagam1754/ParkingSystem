import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { query, withTransaction } from '../db/pool.js';
import { processEntryScan, processExitScan } from '../services/allotment.js';
import { resolvePlateFromOcr } from '../utils/plateMatch.js';
<<<<<<< HEAD
import { acceptWebcamPlate } from '../utils/plateGate.js';
=======
import { emitAssistantTips } from '../services/assistantTips.js';
>>>>>>> origin/feature/mobile-app

const router = Router();
const PYTHON_ALPR_URL = process.env.PYTHON_ALPR_URL || 'http://127.0.0.1:5001';

function emitLive(req, payload, eventName = 'session.updated') {
  const io = req.app.get('io');
  if (!io) return;
  io.emit('occupancy.updated', { at: new Date().toISOString() });
  io.emit(eventName, payload);
  if (eventName === 'checkin.success' || payload?.allotted) {
    io.emit('checkin.success', payload);
  }
  if (eventName === 'checkout.success' || payload?.closed) {
    io.emit('checkout.success', payload);
  }
  emitAssistantTips(io);
}

async function getKnownPlates() {
  const registered = await query(
    `SELECT plate_normalized FROM vehicles WHERE status = 'ACTIVE' AND deleted_at IS NULL`
  );
  return registered.map((r) => r.plate_normalized);
}

async function runOcr(imageBase64, knownPlates) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${PYTHON_ALPR_URL}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        knownPlates,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || data.message || 'Python ALPR failed');
      err.status = response.status;
      err.detail = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error('Plate scan timed out — hold plate closer/ steadier, or use Upload plate photo');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function applyKnownMatch(ocr, knownPlates) {
  const resolved = resolvePlateFromOcr(
    {
      plate: ocr.plate,
      candidates: ocr.candidates || [],
      rawText: ocr.rawText || '',
    },
    knownPlates
  );
  if (resolved.plate) {
    return {
      ...ocr,
      rawPlate: ocr.plate,
      plate: resolved.plate,
      matchedRegistered: resolved.matched,
      matchMethod: resolved.method,
      confidence: resolved.matched ? Math.max(Number(ocr.confidence || 0), 0.9) : ocr.confidence,
      message: resolved.matched
        ? `Matched ${resolved.plate} (${resolved.method})`
        : ocr.message,
    };
  }
  return ocr;
}

router.post(
  '/scan',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const knownPlates = await getKnownPlates();
      let ocr = await runOcr(req.body?.imageBase64, knownPlates);
      ocr = applyKnownMatch(ocr, knownPlates);
      // Hide OCR gibberish from the UI — empty camera must not look like a plate
      const gate = acceptWebcamPlate(ocr);
      if (!gate.ok) {
        return res.json({
          ...ocr,
          plate: null,
          confidence: 0,
          matchedRegistered: false,
          message: gate.reason,
        });
      }
      return res.json({ ...ocr, plate: gate.plate });
    } catch (err) {
      console.error(err);
      return res.status(err.status || 503).json({
        error: err.message || 'ALPR service unavailable. Is the Python scanner running on :5001?',
        detail: err.detail,
      });
    }
  }
);

router.post(
  '/check-in',
  requireAuth,
  requireRoles('SUPER_ADMIN', 'LOT_ADMIN', 'SECURITY_OPERATOR'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const source = body.source || 'WEBCAM';
      let plate = null;
      let confidence = Number(body.confidence ?? 0.9);
      let ocr = null;
      const knownPlates = await getKnownPlates();

      // Gate check-in: WEBCAM must scan an image — never allot from typed/demo plate alone
      if (source === 'WEBCAM') {
        if (!body.imageBase64) {
          return res.status(422).json({
            error: 'Camera image required. Slot is allotted only after a plate scan.',
          });
        }
        ocr = applyKnownMatch(await runOcr(body.imageBase64, knownPlates), knownPlates);
        const gate = acceptWebcamPlate(ocr);
        if (!gate.ok) {
          return res.status(422).json({ error: gate.reason, ocr });
        }
        plate = gate.plate;
        confidence = Number(ocr.confidence ?? confidence);
      } else if (body.imageBase64) {
        ocr = applyKnownMatch(await runOcr(body.imageBase64, knownPlates), knownPlates);
        plate = ocr.plate || null;
        confidence = Number(ocr.confidence ?? confidence);
      } else if (body.plate) {
        // Manual desk / non-webcam tools only
        const resolved = resolvePlateFromOcr({ plate: body.plate }, knownPlates);
        plate = resolved.plate || null;
      }

      if (!plate) {
        return res.status(422).json({
          error: 'Could not read number plate. Hold plate steady inside the yellow box.',
          ocr,
        });
      }

      // Auto vehicle type from registered vehicle when possible
      const vehicles = await query(
        `SELECT vehicle_type FROM vehicles WHERE plate_normalized = ? AND deleted_at IS NULL LIMIT 1`,
        [String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '')]
      );
      const vehicleType = vehicles[0]?.vehicle_type || body.vehicleType || 'CAR';

      const result = await withTransaction((conn) =>
        processEntryScan(conn, {
          plate,
          vehicleType,
          confidence,
          // no manual basement — engine picks company/general pool
          baseId: null,
          source,
          idempotencyKey: body.idempotencyKey,
        })
      );

      emitLive(req, { ...result, ocr }, result.allotted ? 'checkin.success' : 'session.updated');
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
      const body = req.body || {};
      const source = body.source || 'WEBCAM';
      let plate = null;
      let ocr = null;

      if (source === 'WEBCAM') {
        if (!body.imageBase64) {
          return res.status(422).json({
            error: 'Camera image required. Check-out only after a plate scan.',
          });
        }
        const knownPlates = await getKnownPlates();
        ocr = applyKnownMatch(await runOcr(body.imageBase64, knownPlates), knownPlates);
        const gate = acceptWebcamPlate(ocr);
        if (!gate.ok) {
          return res.status(422).json({ error: gate.reason, ocr });
        }
        plate = gate.plate;
      } else {
        plate = body.plate || null;
        if (!plate && body.imageBase64) {
          const knownPlates = await getKnownPlates();
          ocr = applyKnownMatch(await runOcr(body.imageBase64, knownPlates), knownPlates);
          plate = ocr.plate;
        }
      }

      if (!plate) {
        return res.status(422).json({
          error: 'Could not read number plate for check-out.',
          ocr,
        });
      }

      const result = await withTransaction((conn) =>
        processExitScan(conn, {
          plate,
          confidence: body.confidence,
          source,
        })
      );
      emitLive(req, result, 'checkout.success');
      return res.json(result);
    } catch (err) {
      console.error(err);
      return res.status(err.status || 500).json({ error: err.message || 'Check-out failed' });
    }
  }
);

export default router;
