import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { BasesAPI, DashboardAPI, SessionsAPI } from '../api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

function SlotCell({ slot }) {
  return (
    <div
      className={`slot ${slot.vehicle_type.toLowerCase()} ${slot.status}`}
      title={
        slot.plate_normalized
          ? `${slot.code} · ${slot.plate_normalized}`
          : `${slot.code} · ${slot.status}`
      }
    >
      <strong>{slot.code}</strong>
      <small>
        {slot.status === 'OCCUPIED'
          ? slot.plate_normalized || 'Occupied'
          : slot.vehicle_type === 'CAR'
            ? 'Car'
            : 'Bike'}
      </small>
    </div>
  );
}

export default function LiveMap() {
  const [bases, setBases] = useState([]);
  const [selectedBaseId, setSelectedBaseId] = useState(null);
  const [occupancy, setOccupancy] = useState(null);
  const [overview, setOverview] = useState(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadBases = useCallback(async () => {
    const list = await BasesAPI.list();
    setBases(list);
    setSelectedBaseId((prev) => prev || list[0]?.id || null);
  }, []);

  const loadOccupancy = useCallback(async (baseId) => {
    if (!baseId) return;
    setOccupancy(await BasesAPI.occupancy(baseId));
  }, []);

  const loadOverview = useCallback(async () => {
    setOverview(await DashboardAPI.overview());
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadBases(), loadOverview()]);
    if (selectedBaseId) await loadOccupancy(selectedBaseId);
  }, [loadBases, loadOverview, loadOccupancy, selectedBaseId]);

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    if (selectedBaseId) loadOccupancy(selectedBaseId).catch((err) => setError(err.message));
  }, [selectedBaseId, loadOccupancy]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('occupancy.updated', () => refresh().catch(() => {}));
    socket.on('session.updated', () => refresh().catch(() => {}));
    return () => socket.disconnect();
  }, [refresh]);

  async function runRandom(forceGeneral = false) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await SessionsAPI.randomEntry(forceGeneral);
      if (result.allotted) {
        setMessage(
          `${result.plateNormalized} → ${result.slot.code} @ ${result.base.name} (${result.sessionType})`
        );
        setSelectedBaseId(result.base.id);
      } else {
        setError(result.reason || 'Could not allot');
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totals = overview?.totals || {};

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Live basement map</h2>
          <p>One basement · multiple company pools + general · FCFS allotment</p>
        </div>
        <div className="actions">
          <span className="live-pill">
            <i />
            {live ? 'Live feed on' : 'Connecting…'}
          </span>
          <button className="btn btn-secondary" type="button" onClick={() => refresh()}>
            Refresh
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => runRandom(false)}>
            Simulate entry
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span>Total slots</span>
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
          <span>Guest vehicles</span>
          <strong>{totals.guest_vehicles ?? '—'}</strong>
        </div>
      </div>

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
              Free {base.free_total}/{base.slot_total}
            </div>
          </button>
        ))}
      </div>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="scan-result success">{message}</div> : null}

      <div className="grid-2">
        <section className="stack">
          {(occupancy?.groups || []).map((group) => (
            <div className="panel" key={group.key}>
              <div className="panel-header">
                <h3>
                  {group.companyName}
                  <span className="badge" style={{ marginLeft: 8 }}>
                    {group.ownerType}
                  </span>
                </h3>
                <span className="muted">
                  Cars {group.cars.filter((s) => s.status === 'FREE').length}/{group.cars.length} ·
                  Bikes {group.bikes.filter((s) => s.status === 'FREE').length}/{group.bikes.length}
                </span>
              </div>

              <div className="slot-section">
                <h4>
                  <span className="legend-dot" style={{ background: 'var(--car)' }} />
                  Car slots
                </h4>
                <div className="slot-grid">
                  {group.cars.map((slot) => (
                    <SlotCell key={slot.id} slot={slot} />
                  ))}
                </div>
              </div>

              <div className="slot-section">
                <h4>
                  <span className="legend-dot" style={{ background: 'var(--bike)' }} />
                  Bike slots
                </h4>
                <div className="slot-grid">
                  {group.bikes.map((slot) => (
                    <SlotCell key={slot.id} slot={slot} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Company pools</h3>
            </div>
            <div className="stack">
              {(overview?.companyPools || []).map((c) => (
                <div key={c.id} className="scan-result">
                  <strong>
                    {c.name} ({c.code})
                  </strong>
                  <span>
                    Free {c.free_slots}/{c.total_slots} · Occupied {c.occupied_slots}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Recent check-ins</h3>
            </div>
            <div className="stack">
              {(overview?.recent || []).slice(0, 8).map((row) => (
                <div key={row.id} className="scan-result">
                  <strong>{row.plate_normalized}</strong>
                  <span>
                    {row.slot_code || '—'} · {row.base_name}
                  </span>
                  <span className="muted">
                    {row.session_type} · {row.company_name || 'Guest/General'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
