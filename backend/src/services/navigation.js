import { query } from '../db/pool.js';

/**
 * Recommend a free bay (does not allot) + walking directions from Eastface lobby.
 */
export async function buildNavigationPlan({
  vehicleType = 'CAR',
  companyCode = null,
  preferEv = false,
  asGuest = true,
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

  let slot = null;

  if (company) {
    const rows = await query(
      `${selectSql}
       WHERE s.status = 'FREE'
         AND s.vehicle_type = ?
         AND s.owner_type = 'COMPANY'
         AND s.company_id = ?
         AND b.status = 'ACTIVE'
         ${evClause}
       ORDER BY b.level_no ASC, s.id ASC
       LIMIT 1`,
      [type, company.id]
    );
    slot = rows[0] || null;
  }

  if (!slot) {
    const rows = await query(
      `${selectSql}
       WHERE s.status = 'FREE'
         AND s.vehicle_type = ?
         AND s.owner_type = 'GENERAL'
         AND s.company_id IS NULL
         AND b.status = 'ACTIVE'
         ${evClause}
       ORDER BY b.level_no ASC, s.id ASC
       LIMIT 1`,
      [type]
    );
    slot = rows[0] || null;
  }

  if (!slot) {
    const rows = await query(
      `${selectSql}
       WHERE s.status = 'FREE'
         AND s.vehicle_type = ?
         AND b.status = 'ACTIVE'
         ${evClause}
       ORDER BY b.level_no ASC, s.id ASC
       LIMIT 1`,
      [type]
    );
    slot = rows[0] || null;
  }

  if (!slot) {
    return {
      ok: false,
      reason: preferEv
        ? `No free ${type} EV bay right now.`
        : `No free ${type} bay right now — lot may be full.`,
    };
  }

  const steps = buildLobbyDirections(slot);
  const summary = [
    `Park at **${slot.slot_code}** on **${slot.base_code}** (${slot.base_name}).`,
    slot.has_ev_charger ? 'This bay has an **EV charger**.' : null,
    slot.company_name
      ? `Pool: ${slot.company_name} (${slot.company_code}).`
      : 'Pool: GENERAL visitor parking.',
    '',
    '**From the Eastface lobby:**',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
  ]
    .filter((line) => line !== null)
    .join('\n');

  return {
    ok: true,
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
