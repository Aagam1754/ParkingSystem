import { query } from '../db/pool.js';

const B1_TIP_THRESHOLD = Number(process.env.ASSISTANT_B1_TIP_PCT || 80);

function pct(occupied, total) {
  if (!total) return 0;
  return Math.round((Number(occupied) / Number(total)) * 100);
}

/**
 * Live crowd tips for the Smart Parking Assistant (socket + REST).
 */
export async function getAssistantTips() {
  const floors = await query(
    `SELECT b.code, b.name, b.level_no,
      COUNT(s.id) AS total,
      SUM(s.status = 'OCCUPIED') AS occupied,
      SUM(s.status = 'FREE') AS free_count
     FROM bases b
     LEFT JOIN slots s ON s.base_id = b.id
     WHERE b.status = 'ACTIVE'
     GROUP BY b.id
     ORDER BY b.level_no`
  );

  const tips = [];
  const b1 = floors.find((f) => f.code === 'B1');
  if (b1) {
    const occupancyPct = pct(b1.occupied, b1.total);
    if (occupancyPct >= B1_TIP_THRESHOLD) {
      const alternatives = floors
        .filter((f) => f.code !== 'B1' && Number(f.free_count) > 0)
        .map((f) => `${f.code} (${f.free_count} free)`)
        .join(', ');

      tips.push({
        id: 'b1-crowded',
        severity: 'warn',
        basement: 'B1',
        occupancyPct,
        free: Number(b1.free_count),
        total: Number(b1.total),
        threshold: B1_TIP_THRESHOLD,
        title: `B1 is ${occupancyPct}% full`,
        message: alternatives
          ? `Basement 1 visitor parking is crowded. Registered members: use company pools on ${alternatives}. Guests: expect waits or try again after exits.`
          : 'Basement 1 visitor parking is crowded and other basements look tight too — expect waits.',
      });
    }
  }

  return {
    at: new Date().toISOString(),
    threshold: B1_TIP_THRESHOLD,
    tips,
    floors: floors.map((f) => ({
      code: f.code,
      name: f.name,
      level: f.level_no,
      total: Number(f.total),
      occupied: Number(f.occupied),
      free: Number(f.free_count),
      occupancyPct: pct(f.occupied, f.total),
    })),
  };
}

export async function emitAssistantTips(io) {
  if (!io) return null;
  try {
    const payload = await getAssistantTips();
    io.emit('assistant.tip', payload);
    return payload;
  } catch (err) {
    console.warn('[assistant.tip] emit failed:', err.message);
    return null;
  }
}
