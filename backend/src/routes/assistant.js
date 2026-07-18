import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { buildParkingContext, estimateParkingCost } from '../services/parkingContext.js';
import { generateAssistantReply } from '../services/assistantLlm.js';

const router = Router();

router.get('/context', requireAuth, async (_req, res) => {
  try {
    const context = await buildParkingContext();
    res.json(context);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to build parking context' });
  }
});

router.post('/estimate', requireAuth, async (req, res) => {
  try {
    const hours = Number(req.body?.hours ?? 3);
    const sessionType = String(req.body?.sessionType || 'GUEST').toUpperCase();
    const vehicleType = String(req.body?.vehicleType || 'CAR').toUpperCase();
    const context = await buildParkingContext();
    const estimate = estimateParkingCost(context, { hours, sessionType, vehicleType });
    if (!estimate.ok) return res.status(400).json({ error: estimate.error });
    res.json(estimate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Estimate failed' });
  }
});

router.post('/chat', requireAuth, async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (message.length > 2000) {
      return res.status(400).json({ error: 'message too long (max 2000 chars)' });
    }

    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const context = await buildParkingContext();
    const result = await generateAssistantReply({ message, context, history });

    res.json({
      reply: result.reply,
      mode: result.mode,
      model: result.model,
      warning: result.warning || null,
      contextSummary: {
        generatedAt: context.generatedAt,
        crowd: context.summary.crowd,
        occupancyPct: context.summary.occupancyPct,
        freeSlots: context.summary.freeSlots,
        evFree: context.summary.evFree,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Assistant chat failed' });
  }
});

export default router;
