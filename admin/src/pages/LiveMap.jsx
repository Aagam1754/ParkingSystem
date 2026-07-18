import { useCallback, useEffect, useState } from 'react';
import { BasesAPI, DashboardAPI } from '../api';
import { useSocket } from '../hooks/useSocket';

function SlotCell({ slot, color }) {
  return (
    <div
      className={`slot ${slot.vehicle_type.toLowerCase()} ${slot.status}`}
      style={{
        borderColor: `${color}99`,
        background:
          slot.status === 'OCCUPIED'
            ? `linear-gradient(160deg, ${color}66, rgba(255,93,93,0.28))`
            : `linear-gradient(160deg, ${color}40, rgba(61,255,168,0.14))`,
      }}
      title={slot.plate_normalized ? `${slot.code} · ${slot.plate_normalized}` : slot.code}
    >
      <strong>{slot.code}</strong>
      <small>{slot.status === 'OCCUPIED' ? slot.plate_normalized || 'Busy' : slot.vehicle_type}</small>
    </div>
  );
}

export default function LiveMap() {
  const [building, setBuilding] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [bases, setBases] = useState([]);
  const [selectedBaseId, setSelectedBaseId] = useState(null);
  const [occupancy, setOccupancy] = useState(null);
  const [overview, setOverview] = useState(null);
  const [message] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [list, ov, bld, cos] = await Promise.all([
      BasesAPI.list(),
      DashboardAPI.overview(),
      DashboardAPI.building(),
      DashboardAPI.companies(),
    ]);
    setBases(list);
    setOverview(ov);
    setBuilding(bld);
    setCompanies(cos);
    setSelectedBaseId((prev) => prev || list[0]?.id || null);
    const id = selectedBaseId || list[0]?.id;
    if (id) setOccupancy(await BasesAPI.occupancy(id));
  }, [selectedBaseId]);

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    if (selectedBaseId) {
      BasesAPI.occupancy(selectedBaseId)
        .then(setOccupancy)
        .catch((err) => setError(err.message));
    }
  }, [selectedBaseId]);

  const { live } = useSocket({
    'occupancy.updated': () => refresh().catch(() => {}),
    'session.updated': () => refresh().catch(() => {}),
    'checkin.success': () => refresh().catch(() => {}),
    'checkout.success': () => refresh().catch(() => {}),
  });

  const totals = overview?.totals || {};

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>{building?.name || 'Eastface'} parking map</h2>
          <p>
            {building
              ? `${building.address}, ${building.city}, ${building.state} ${building.pincode}`
              : '3 basements · B1 general · B2/B3 multi-company'}
          </p>
        </div>
        <div className="actions">
          <span className="live-pill">
            <i />
            {live ? 'Live' : 'Connecting…'}
          </span>
          <button className="btn btn-secondary" type="button" onClick={() => refresh()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span>Slots</span>
          <strong>{totals.slots ?? '—'}</strong>
        </div>
        <div className="stat">
          <span>Free</span>
          <strong>{totals.free_slots ?? '—'}</strong>
        </div>
        <div className="stat">
          <span>Occupied</span>
          <strong>{totals.occupied_slots ?? '—'}</strong>
        </div>
        <div className="stat">
          <span>Active</span>
          <strong>{totals.active_sessions ?? '—'}</strong>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3>Companies in {building?.name || 'building'}</h3>
        </div>
        <div className="company-legend">
          <div className="legend-item">
            <span className="company-swatch" style={{ background: '#8FA9A0' }} />
            General Parking
          </div>
          {companies.map((c) => (
            <div className="legend-item" key={c.id}>
              <span className="company-swatch" style={{ background: c.color_hex }} />
              <div>
                <strong>{c.name}</strong>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  {c.floor_label} · {c.code}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="base-tabs">
        {bases.map((base) => (
          <button
            key={base.id}
            type="button"
            className={`base-tab ${selectedBaseId === base.id ? 'active' : ''}`}
            onClick={() => setSelectedBaseId(base.id)}
          >
            {base.name}
            <div style={{ fontSize: '0.78rem', marginTop: 4, opacity: 0.85 }}>
              {base.base_kind} · Free {base.free_total}/{base.slot_total}
            </div>
          </button>
        ))}
      </div>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="scan-result success">{message}</div> : null}

      <div className="stack">
        {(occupancy?.groups || []).map((group) => (
          <section className="panel company-block" key={group.key} style={{ '--company': group.colorHex }}>
            <div className="panel-header">
              <h3>
                <span className="company-swatch" style={{ background: group.colorHex }} />{' '}
                {group.companyName}
                <span className="badge" style={{ marginLeft: 8 }}>
                  {group.companyCode}
                </span>
              </h3>
              <span className="muted">
                Cars {group.cars.filter((s) => s.status === 'FREE').length}/{group.cars.length} · Bikes{' '}
                {group.bikes.filter((s) => s.status === 'FREE').length}/{group.bikes.length}
              </span>
            </div>
            <div className="slot-section">
              <h4>Car slots</h4>
              <div className="slot-grid">
                {group.cars.map((slot) => (
                  <SlotCell key={slot.id} slot={slot} color={group.colorHex} />
                ))}
              </div>
            </div>
            <div className="slot-section">
              <h4>Bike slots</h4>
              <div className="slot-grid">
                {group.bikes.map((slot) => (
                  <SlotCell key={slot.id} slot={slot} color={group.colorHex} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
