import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { buildParkingContext, estimateParkingCost } from '../services/parkingContext.js';
import { generateAssistantReply } from '../services/assistantLlm.js';
import { buildNavigationPlan } from '../services/navigation.js';
import { getAssistantTips } from '../services/assistantTips.js';
import {
  getElevenLabsConfig,
  isElevenLabsConfigured,
  synthesizeSpeech,
} from '../services/elevenLabs.js';

const router = Router();

router.get('/voice', requireAuth, (_req, res) => {
  res.json(getElevenLabsConfig());
});

router.post('/speak', requireAuth, async (req, res) => {
  try {
    if (!isElevenLabsConfigured()) {
      return res.status(503).json({
        error: 'ElevenLabs TTS is not configured. Add ELEVENLABS_API_KEY to backend/.env',
      });
    }
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 4000) {
      return res.status(400).json({ error: 'text too long for speech (max 4000 chars)' });
    }

    const result = await synthesizeSpeech(text);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('X-ParkLane-TTS-Chars', String(result.chars));
    res.setHeader('X-ParkLane-TTS-Voice', result.voiceId);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.audio);
  } catch (err) {
    console.error('[assistant/speak]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Speech synthesis failed' });
  }
});

router.get('/context', requireAuth, async (_req, res) => {
  try {
    const context = await buildParkingContext();
    res.json(context);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to build parking context' });
  }
});

router.get('/tips', requireAuth, async (_req, res) => {
  try {
    const tips = await getAssistantTips();
    res.json(tips);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to load tips' });
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

router.post('/navigate', requireAuth, async (req, res) => {
  try {
    const vehicleType = String(req.body?.vehicleType || 'CAR').toUpperCase();
    const companyCode = req.body?.companyCode || null;
    const preferEv = Boolean(req.body?.preferEv);
    const asGuest = req.body?.asGuest !== false && !companyCode;
    const plan = await buildNavigationPlan({
      vehicleType,
      companyCode,
      preferEv,
      asGuest: companyCode ? false : asGuest,
    });
    if (!plan.ok) return res.status(409).json({ error: plan.reason, ...plan });
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Navigation failed' });
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
    const tips = await getAssistantTips();
    context.liveTips = tips.tips;

    const result = await generateAssistantReply({ message, context, history });

    res.json({
      reply: result.reply,
      mode: result.mode,
      model: result.model,
      warning: result.warning || null,
      navigation: result.navigation || null,
      contextSummary: {
        generatedAt: context.generatedAt,
        crowd: context.summary.crowd,
        occupancyPct: context.summary.occupancyPct,
        freeSlots: context.summary.freeSlots,
        evFree: context.summary.evFree,
        tips: tips.tips,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Assistant chat failed' });
  }
});

export default router;
