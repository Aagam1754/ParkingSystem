import { estimateParkingCost } from './parkingContext.js';
import { buildNavigationPlan, formatNavigationReply } from './navigation.js';

const SYSTEM_PROMPT = `You are ParkLane Smart Parking Assistant for the Eastface building in Ahmedabad.
Answer briefly and helpfully using ONLY the live parking CONTEXT JSON provided.
Be specific with basement codes (B1/B2/B3), free slot counts, EV chargers, INR cost estimates, and lobby walking directions when asked to navigate.
If data is missing, say so. Do not invent basements, companies, or prices.
Prefer short paragraphs and bullet points. Use Indian English casually.`;

function extractHours(text) {
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/i);
  return m ? Number(m[1]) : null;
}

function looksLike(text, patterns) {
  const t = String(text).toLowerCase();
  return patterns.some((p) => (p instanceof RegExp ? p.test(t) : t.includes(p)));
}

function extractCompanyCode(text) {
  const m = String(text).match(/\b(YORK|NEXUS|ORBIT)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function isNavigateIntent(message) {
  return looksLike(message, [
    /navigat/i,
    /directions?/i,
    /how do i (get|walk|reach)/i,
    /take me to/i,
    'navigate me',
  ]);
}

/** Deterministic answers when no LLM API key is configured — still uses live data. */
export async function answerFromContext(message, context) {
  const hours = extractHours(message) ?? 3;
  const costGuest = estimateParkingCost(context, {
    hours,
    sessionType: 'GUEST',
    vehicleType: 'CAR',
  });
  const costCompany = estimateParkingCost(context, {
    hours,
    sessionType: 'COMPANY',
    vehicleType: 'CAR',
  });

  if (isNavigateIntent(message)) {
    const preferEv = looksLike(message, [/ev/i, /charg/i, /electric/i]);
    const vehicleType = looksLike(message, [/bike|scooter|two.?wheeler/i]) ? 'BIKE' : 'CAR';
    const companyCode = extractCompanyCode(message);
    const plan = await buildNavigationPlan({
      vehicleType,
      companyCode,
      preferEv,
      asGuest: !companyCode,
    });
    return {
      reply: formatNavigationReply(plan),
      navigation: plan.ok ? plan : null,
    };
  }

  if (looksLike(message, [/where.*(park|should)/i, /which.*(basement|floor|level).*park/i, 'where should i park'])) {
    const rec = context.recommendations.guestOrVisitor;
    const lightest = [...context.floors].sort((a, b) => a.occupancyPct - b.occupancyPct)[0];
    const companyHint = context.companyPools
      .filter((p) => p.free > 0)
      .sort((a, b) => b.free - a.free)
      .slice(0, 3)
      .map((p) => `• ${p.company} on ${p.basement}: ${p.free} free`)
      .join('\n');
    const tipLine =
      Array.isArray(context.liveTips) && context.liveTips.length
        ? context.liveTips.map((t) => `⚠ ${t.message}`).join('\n')
        : null;

    return {
      reply: [
        `Right now parking is **${context.summary.crowd}** overall (${context.summary.occupancyPct}% full, ${context.summary.freeSlots} free of ${context.summary.totalSlots}).`,
        tipLine,
        rec
          ? `**Visitors / guests:** head to **${rec.basement}** (${rec.name}) — ${rec.carFree} car + ${rec.bikeFree} bike free. ${rec.note}`
          : 'No general basement found in live data.',
        lightest
          ? `**Lightest basement overall:** ${lightest.code} at ${lightest.occupancyPct}% occupied (${lightest.free} free).`
          : null,
        companyHint ? `**Company pools with space:**\n${companyHint}` : null,
        'Say **Navigate me** for a specific bay + walking directions from the lobby.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }

  if (looksLike(message, [/crowd/i, /busy/i, /how full/i, /occupancy/i, /availability/i])) {
    const lines = context.floors
      .map(
        (f) =>
          `• **${f.code}** (${f.name}): ${f.crowd} — ${f.occupied}/${f.total} occupied (${f.occupancyPct}%), ${f.free} free`
      )
      .join('\n');
    return {
      reply: [
        `Today so far: **${context.summary.entriesToday}** entries, **${context.summary.activeSessions}** vehicles still parked.`,
        `Overall: **${context.summary.crowd}** (${context.summary.occupancyPct}% full).`,
        lines,
      ].join('\n\n'),
    };
  }

  if (looksLike(message, [/ev/i, /charg/i, /electric/i])) {
    const byFloor = context.floors
      .filter((f) => f.evTotal > 0)
      .map((f) => `• **${f.code}** (level ${f.level}): ${f.evFree} free EV of ${f.evTotal}`)
      .join('\n');
    const samples = context.freeEvSlots
      .slice(0, 8)
      .map((s) => `${s.slot} on ${s.basement}${s.companyCode ? ` (${s.companyCode})` : ''}`)
      .join(', ');
    return {
      reply: [
        `EV chargers live now: **${context.summary.evFree} free** of ${context.summary.evSlots} total.`,
        byFloor || 'No EV-marked floors in the live snapshot.',
        samples ? `Open EV bays include: ${samples}.` : 'No free EV bays at the moment.',
        'Ask **Navigate me to an EV bay** for lobby walking directions.',
      ].join('\n\n'),
    };
  }

  if (looksLike(message, [/cost/i, /price/i, /how much/i, /₹|rs\.?|inr/i, /fee|tariff|pay/i])) {
    const rateLines = context.rates
      .map(
        (r) =>
          `• ${r.sessionType} ${r.vehicleType}: ₹${r.hourlyInr}/hr` +
          (r.dailyCapInr != null ? ` (cap ₹${r.dailyCapInr}/day)` : '') +
          (r.notes ? ` — ${r.notes}` : '')
      )
      .join('\n');
    return {
      reply: [
        `Estimated stay **${hours} hours**:`,
        costGuest.ok
          ? `• Guest / visitor car: **₹${costGuest.estimatedInr}** (₹${costGuest.hourlyInr}/hr)`
          : null,
        costCompany.ok
          ? `• Company member car: **₹${costCompany.estimatedInr}** (₹${costCompany.hourlyInr}/hr)`
          : null,
        rateLines ? `**Tariff card:**\n${rateLines}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }

  return {
    reply: [
      `Eastface ParkLane snapshot (${new Date(context.generatedAt).toLocaleString('en-IN')}):`,
      `• Crowd: **${context.summary.crowd}** (${context.summary.occupancyPct}% full)`,
      `• Free slots: ${context.summary.freeSlots} · Active sessions: ${context.summary.activeSessions}`,
      `• EV free: ${context.summary.evFree}/${context.summary.evSlots}`,
      context.recommendations.guestOrVisitor
        ? `• Best for visitors: **${context.recommendations.guestOrVisitor.basement}**`
        : null,
      'Try: where should I park, how crowded is it, EV charging, cost for 3 hours, or **Navigate me**.',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function callOpenAI({ message, context, history }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `LIVE PARKING CONTEXT (JSON):\n${JSON.stringify(context)}`,
    },
    ...history
      .slice(-8)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 2000),
      })),
    { role: 'user', content: String(message).slice(0, 2000) },
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM request failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('LLM returned an empty reply');
  return { reply, model, provider: 'openai' };
}

export async function generateAssistantReply({ message, context, history = [] }) {
  if (isNavigateIntent(message)) {
    const preferEv = looksLike(message, [/ev/i, /charg/i, /electric/i]);
    const vehicleType = looksLike(message, [/bike|scooter|two.?wheeler/i]) ? 'BIKE' : 'CAR';
    const companyCode = extractCompanyCode(message);
    const plan = await buildNavigationPlan({
      vehicleType,
      companyCode,
      preferEv,
      asGuest: !companyCode,
    });
    return {
      reply: formatNavigationReply(plan),
      mode: 'navigate',
      model: null,
      navigation: plan.ok ? plan : null,
    };
  }

  try {
    const llm = await callOpenAI({ message, context, history });
    if (llm) {
      return { reply: llm.reply, mode: 'llm', model: llm.model, navigation: null };
    }
  } catch (err) {
    console.warn('[assistant] LLM failed, using live-data fallback:', err.message);
    const fallback = await answerFromContext(message, context);
    return {
      reply: `${fallback.reply}\n\n_(LLM unavailable — answered from live parking data.)_`,
      mode: 'fallback',
      model: null,
      warning: err.message,
      navigation: fallback.navigation || null,
    };
  }

  const ruled = await answerFromContext(message, context);
  return {
    reply: ruled.reply,
    mode: 'rules',
    model: null,
    navigation: ruled.navigation || null,
  };
}
