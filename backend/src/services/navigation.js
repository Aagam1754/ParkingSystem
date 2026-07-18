import { query } from '../db/pool.js';

/** Eastface · Ambli Rd / Iscon (approx) — used for member GPS proximity tips */
export const EASTFACE_COORDS = { lat: 23.0216, lng: 72.5074, label: 'Eastface lobby, Ambli Rd' };

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function describeUserLocation(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const meters = haversineMeters(latitude, longitude, EASTFACE_COORDS.lat, EASTFACE_COORDS.lng);
  const km = meters / 1000;
  let proximity;
  if (meters < 80) proximity = 'AT_LOBBY';
  else if (meters < 400) proximity = 'ON_CAMPUS';
  else if (km < 3) proximity = 'NEARBY';
  else proximity = 'FAR';
  return {
    lat: latitude,
    lng: longitude,
    distanceMeters: Math.round(meters),
    distanceKm: Math.round(km * 10) / 10,
    proximity,
    building: EASTFACE_COORDS,
  };
}

/** Short TTS script — only the free bay + how to reach it (not the full markdown reply). */
export function buildSpokenNavigationScript(plan, location = null) {
  if (!plan?.ok || !plan.recommendation) {
    return plan?.reason || 'No free parking bay is available right now.';
  }
  const rec = plan.recommendation;
  const pool =
    plan.poolPath === 'COMPANY'
      ? `in your ${rec.company?.code || 'company'} pool`
      : plan.poolPath === 'GENERAL_OVERFLOW'
        ? 'in general overflow because your company pool is full'
        : 'in general visitor parking';

  const locLine =
    location?.proximity === 'AT_LOBBY'
      ? 'You are at the Eastface lobby now.'
      : location?.proximity === 'ON_CAMPUS'
        ? `You are about ${location.distanceMeters} meters from the Eastface lobby.`
        : location?.distanceKm != null
          ? `You are about ${location.distanceKm} kilometers from Eastface.`
          : null;

  const stepPlain = (plan.steps || [])
    .slice(0, 5)
    .map((s) => String(s).replace(/\*\*/g, ''))
    .join(' ');

  return [
    `Your available parking bay is ${rec.slotCode} on ${rec.basement.code}, ${rec.basement.name}, ${pool}.`,
    rec.hasEvCharger ? 'This bay has an EV charger.' : null,
    `Bay is at row ${rec.row}, column ${rec.col}.`,
    locLine,
    stepPlain ? `Directions: ${stepPlain}` : null,
    'Drive to that free bay. The gate camera will confirm the real allotment when you check in.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Recommend a free bay (does not allot) + walking directions from Eastface lobby.
 * Matches allotment.js: company pool FCFS → GENERAL overflow. Never another company's bay.
 */
export async function buildNavigationPlan({
  vehicleType = 'CAR',
  companyCode = null,
  preferEv = false,
  asGuest = true,
  lat = null,
  lng = null,
} = {}) {
  const type = String(vehicleType || 'CAR').toUpperCase() === 'BIKE' ? 'BIKE' : 'CAR';
  const code = companyCode ? String(companyCode).trim().toUpperCase() : null;
  const evClause = preferEv ? 'AND s.has_ev_charger = 1' : '';

  let company = null;
  if (code && !asGuest) {
    const rows = await query(`SELECT id, name, code, floor_label FROM companies WHERE code = ? LIMIT 1`, [
      code,
    ]);
    company = rows[0] || null;
  }

  const selectSql = `
    SELECT s.id, s.code AS slot_code, s.vehicle_type, s.owner_type, s.has_ev_charger,
           s.row_no, s.col_no, s.status,
           b.id AS base_id, b.name AS base_name, b.code AS base_code, b.level_no, b.description,
           c.name AS company_name, c.code AS company_code, c.floor_label
    FROM slots s
    JOIN bases b ON b.id = s.base_id
    LEFT JOIN companies c ON c.id = s.company_id
  `;

  // Same FCFS ordering spirit as allotment: lowest basement id, then lowest slot id
  const orderFCFS = 'ORDER BY b.id ASC, s.id ASC';

  let slot = null;
  let poolPath = 'GENERAL';

  if (company) {
    const rows = await query(
      `${selectSql}
       WHERE s.status = 'FREE'
         AND s.vehicle_type = ?
         AND s.owner_type = 'COMPANY'
         AND s.company_id = ?
         AND b.status = 'ACTIVE'
         ${evClause}
       ${orderFCFS}
       LIMIT 1`,
      [type, company.id]
    );
    slot = rows[0] || null;
    if (slot) poolPath = 'COMPANY';
  }

  // Company full or guest → GENERAL only (never another company's reserved bay)
  if (!slot) {
    const rows = await query(
      `${selectSql}
       WHERE s.status = 'FREE'
         AND s.vehicle_type = ?
         AND s.owner_type = 'GENERAL'
         AND s.company_id IS NULL
         AND b.status = 'ACTIVE'
         ${evClause}
       ${orderFCFS}
       LIMIT 1`,
      [type]
    );
    slot = rows[0] || null;
    if (slot) {
      poolPath = company ? 'GENERAL_OVERFLOW' : 'GENERAL';
    }
  }

  if (!slot) {
    return {
      ok: false,
      reason: preferEv
        ? `No free ${type} EV bay in your company pool or GENERAL right now.`
        : company
          ? `No free ${type} bay in ${company.code} pool or GENERAL overflow — lot may be full.`
          : `No free ${type} GENERAL bay right now — lot may be full.`,
    };
  }

  const steps = buildLobbyDirections(slot);
  const poolLine =
    poolPath === 'COMPANY'
      ? `Pool: ${slot.company_name} (${slot.company_code}) — company FCFS (same as gate allotment).`
      : poolPath === 'GENERAL_OVERFLOW'
        ? `Pool: GENERAL overflow — your company pool is full (same as gate allotment).`
        : 'Pool: GENERAL visitor parking (same as gate allotment for guests).';

  const location = describeUserLocation(lat, lng);
  const locationLine =
    location?.proximity === 'AT_LOBBY'
      ? '**Your GPS:** you are at the Eastface lobby — start the walking steps below.'
      : location?.proximity === 'ON_CAMPUS'
        ? `**Your GPS:** ~${location.distanceMeters} m from Eastface lobby.`
        : location
          ? `**Your GPS:** ~${location.distanceKm} km from Eastface (${EASTFACE_COORDS.label}).`
          : null;

  const summary = [
    `Park at **${slot.slot_code}** on **${slot.base_code}** (${slot.base_name}).`,
    slot.has_ev_charger ? 'This bay has an **EV charger**.' : null,
    poolLine,
    locationLine,
    '',
    '**From the Eastface lobby:**',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '_Recommendation only — the gate camera / Manual Desk still runs the real allotment._',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const plan = {
    ok: true,
    poolPath,
    location,
    recommendation: {
      slotCode: slot.slot_code,
      vehicleType: slot.vehicle_type,
      ownerType: slot.owner_type,
      hasEvCharger: Boolean(slot.has_ev_charger),
      row: slot.row_no,
      col: slot.col_no,
      basement: {
        id: slot.base_id,
        code: slot.base_code,
        name: slot.base_name,
        level: slot.level_no,
        description: slot.description,
      },
      company: slot.company_code
        ? {
            name: slot.company_name,
            code: slot.company_code,
            officeFloor: slot.floor_label,
          }
        : null,
    },
    steps,
    summary,
  };
  plan.spokenScript = buildSpokenNavigationScript(plan, location);
  return plan;
}

function buildLobbyDirections(slot) {
  const level = Number(slot.level_no);
  const row = Number(slot.row_no);
  const col = Number(slot.col_no);
  const steps = [
    'Start at the Eastface main lobby (Ambli Rd / Iscon entrance).',
  ];

  if (level === 1) {
    steps.push(
      'Follow signs for **Basement 1 · General Parking** — take the visitor ramp or the parking lift to B1.'
    );
  } else {
    steps.push(
      `Take the parking lift or vehicle ramp down to **Basement ${level} (${slot.base_code})**.`
    );
  }

  if (slot.owner_type === 'COMPANY' && slot.company_name) {
    steps.push(
      `On ${slot.base_code}, enter the **${slot.company_name}** reserved aisle (look for company floor paint / signage).`
    );
  } else {
    steps.push('Stay in the **GENERAL / visitor** aisle — do not enter company-reserved rows.');
  }

  if (slot.has_ev_charger) {
    steps.push('Head toward the green EV / charger icons along the aisle.');
  }

  const bank =
    col <= 5
      ? 'keep to the **left bank** as you enter the aisle'
      : 'continue toward the **right bank** of the aisle';
  steps.push(
    `Find bay **${slot.slot_code}** at row ${row}, column ${col} — ${bank} (slots number left → right, FCFS).`
  );

  if (slot.floor_label && slot.company_name) {
    steps.push(
      `After parking, take the building lift up to **${slot.floor_label}** for ${slot.company_name}.`
    );
  } else {
    steps.push('Return to the lobby lifts when you are ready to enter the office floors.');
  }

  return steps;
}

export function formatNavigationReply(plan) {
  if (!plan?.ok) return plan?.reason || 'No navigation available.';
  return plan.summary;
}
