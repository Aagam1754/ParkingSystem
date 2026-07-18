import { query } from '../db/pool.js';

function pct(occupied, total) {
  if (!total) return 0;
  return Math.round((Number(occupied) / Number(total)) * 100);
}

function crowdLabel(occupancyPct) {
  if (occupancyPct >= 90) return 'packed';
  if (occupancyPct >= 70) return 'busy';
  if (occupancyPct >= 40) return 'moderate';
  return 'light';
}

/**
 * Live parking snapshot for the Smart Parking Assistant.
 */
export async function buildParkingContext() {
  const [building] = await query(
    `SELECT * FROM buildings WHERE status = 'ACTIVE' ORDER BY id LIMIT 1`
  );

  const [totals] = await query(
    `SELECT
      (SELECT COUNT(*) FROM slots) AS slots,
      (SELECT COUNT(*) FROM slots WHERE status = 'FREE') AS free_slots,
      (SELECT COUNT(*) FROM slots WHERE status = 'OCCUPIED') AS occupied_slots,
      (SELECT COUNT(*) FROM slots WHERE has_ev_charger = 1) AS ev_slots,
      (SELECT COUNT(*) FROM slots WHERE has_ev_charger = 1 AND status = 'FREE') AS ev_free,
      (SELECT COUNT(*) FROM parking_sessions WHERE is_open = 1) AS active_sessions,
      (SELECT COUNT(*) FROM parking_sessions WHERE DATE(started_at) = CURDATE()) AS entries_today`
  );

  const byBase = await query(
    `SELECT b.id, b.name, b.code, b.level_no, b.base_kind, b.description,
      COUNT(s.id) AS total,
      SUM(s.status = 'FREE') AS free_count,
      SUM(s.status = 'OCCUPIED') AS occupied_count,
      SUM(s.vehicle_type = 'CAR' AND s.status = 'FREE') AS car_free,
      SUM(s.vehicle_type = 'BIKE' AND s.status = 'FREE') AS bike_free,
      SUM(s.has_ev_charger = 1) AS ev_total,
      SUM(s.has_ev_charger = 1 AND s.status = 'FREE') AS ev_free
     FROM bases b
     LEFT JOIN slots s ON s.base_id = b.id
     WHERE b.status = 'ACTIVE'
     GROUP BY b.id
     ORDER BY b.level_no, b.id`
  );

  const companyPools = await query(
    `SELECT c.name, c.code, c.floor_label,
      b.code AS base_code, b.level_no,
      SUM(s.status = 'FREE') AS free_count,
      SUM(s.status = 'OCCUPIED') AS occupied_count,
      COUNT(s.id) AS total,
      SUM(s.has_ev_charger = 1 AND s.status = 'FREE') AS ev_free
     FROM companies c
     JOIN slots s ON s.company_id = c.id AND s.owner_type = 'COMPANY'
     JOIN bases b ON b.id = s.base_id
     GROUP BY c.id, b.id
     ORDER BY b.level_no, c.id`
  );

  const rates = await query(
    `SELECT session_type, vehicle_type, hourly_inr, daily_cap_inr, notes
     FROM parking_rates
     ORDER BY session_type, vehicle_type`
  );

  const freeEvByBase = await query(
    `SELECT b.code AS base_code, b.name AS base_name, b.level_no,
      s.code AS slot_code, s.vehicle_type, s.owner_type,
      c.name AS company_name, c.code AS company_code
     FROM slots s
     JOIN bases b ON b.id = s.base_id
     LEFT JOIN companies c ON c.id = s.company_id
     WHERE s.has_ev_charger = 1 AND s.status = 'FREE'
     ORDER BY b.level_no, s.id
     LIMIT 24`
  );

  const bestGeneral = byBase
    .filter((b) => b.base_kind === 'GENERAL')
    .map((b) => ({
      ...b,
      occupancyPct: pct(b.occupied_count, b.total),
      crowd: crowdLabel(pct(b.occupied_count, b.total)),
    }))
    .sort((a, b) => Number(b.free_count) - Number(a.free_count))[0];

  const floors = byBase.map((b) => {
    const occupancyPct = pct(b.occupied_count, b.total);
    return {
      code: b.code,
      name: b.name,
      level: b.level_no,
      kind: b.base_kind,
      description: b.description,
      total: Number(b.total),
      free: Number(b.free_count),
      occupied: Number(b.occupied_count),
      carFree: Number(b.car_free),
      bikeFree: Number(b.bike_free),
      evTotal: Number(b.ev_total),
      evFree: Number(b.ev_free),
      occupancyPct,
      crowd: crowdLabel(occupancyPct),
    };
  });

  const overallPct = pct(totals.occupied_slots, totals.slots);

  return {
    generatedAt: new Date().toISOString(),
    building: building
      ? {
          name: building.name,
          code: building.code,
          address: building.address,
          city: building.city,
        }
      : null,
    summary: {
      totalSlots: Number(totals.slots),
      freeSlots: Number(totals.free_slots),
      occupiedSlots: Number(totals.occupied_slots),
      occupancyPct: overallPct,
      crowd: crowdLabel(overallPct),
      activeSessions: Number(totals.active_sessions),
      entriesToday: Number(totals.entries_today),
      evSlots: Number(totals.ev_slots),
      evFree: Number(totals.ev_free),
    },
    floors,
    companyPools: companyPools.map((p) => ({
      company: p.name,
      companyCode: p.code,
      officeFloor: p.floor_label,
      basement: p.base_code,
      level: p.level_no,
      free: Number(p.free_count),
      occupied: Number(p.occupied_count),
      total: Number(p.total),
      occupancyPct: pct(p.occupied_count, p.total),
      evFree: Number(p.ev_free),
    })),
    rates: rates.map((r) => ({
      sessionType: r.session_type,
      vehicleType: r.vehicle_type,
      hourlyInr: Number(r.hourly_inr),
      dailyCapInr: r.daily_cap_inr != null ? Number(r.daily_cap_inr) : null,
      notes: r.notes,
    })),
    freeEvSlots: freeEvByBase.map((s) => ({
      basement: s.base_code,
      level: s.level_no,
      slot: s.slot_code,
      vehicleType: s.vehicle_type,
      pool: s.owner_type,
      company: s.company_name,
      companyCode: s.company_code,
    })),
    recommendations: {
      guestOrVisitor: bestGeneral
        ? {
            basement: bestGeneral.code,
            name: bestGeneral.name,
            free: Number(bestGeneral.free_count),
            carFree: Number(bestGeneral.car_free),
            bikeFree: Number(bestGeneral.bike_free),
            crowd: bestGeneral.crowd,
            note: 'Guests and unknown plates allot to GENERAL (B1) first-come-first-serve.',
          }
        : null,
      allotmentRules: [
        'Registered company vehicles get a free slot from their company pool (FCFS).',
        'If the company pool is full, overflow goes to GENERAL (B1).',
        'Unknown / guest plates auto-register and park in GENERAL (B1).',
        'Prefer the basement with the most free slots in the target pool.',
      ],
    },
  };
}

export function estimateParkingCost(context, { hours = 3, sessionType = 'GUEST', vehicleType = 'CAR' } = {}) {
  const h = Math.max(0, Number(hours) || 0);
  const rate = context.rates.find(
    (r) => r.sessionType === sessionType && r.vehicleType === vehicleType
  );
  if (!rate) {
    return { ok: false, error: `No rate for ${sessionType} / ${vehicleType}` };
  }
  let amount = +(rate.hourlyInr * h).toFixed(2);
  if (rate.dailyCapInr != null && amount > rate.dailyCapInr) {
    amount = rate.dailyCapInr;
  }
  return {
    ok: true,
    hours: h,
    sessionType,
    vehicleType,
    hourlyInr: rate.hourlyInr,
    dailyCapInr: rate.dailyCapInr,
    estimatedInr: amount,
    notes: rate.notes,
  };
}
