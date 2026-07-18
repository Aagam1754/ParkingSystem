import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { BasesAPI, DashboardAPI, SessionsAPI } from '../api';

// Prefer same-origin (Vite proxies /socket.io → API) so remote previews work
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
            ? 'Car bay'
            : 'Bike bay'}
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
    const data = await BasesAPI.occupancy(baseId);
    setOccupancy(data);
  }, []);

  const loadOverview = useCallback(async () => {
    const data = await DashboardAPI.overview();
    setOverview(data);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadBases(), loadOverview()]);
    if (selectedBaseId) await loadOccupancy(selectedBaseId);
  }, [loadBases, loadOverview, loadOccupancy, selectedBaseId]);

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    if (selectedBaseId) {
      loadOccupancy(selectedBaseId).catch((err) => setError(err.message));
    }
  }, [selectedBaseId, loadOccupancy]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('occupancy.updated', () => {
      refresh().catch(() => {});
    });
    socket.on('session.updated', () => {
      refresh().catch(() => {});
    });
    return () => socket.disconnect();
  }, [refresh]);

  const cars = useMemo(
    () => (occupancy?.slots || []).filter((s) => s.vehicle_type === 'CAR'),
    [occupancy]
  );
  const bikes = useMemo(
    () => (occupancy?.slots || []).filter((s) => s.vehicle_type === 'BIKE'),
    [occupancy]
  );

  async function runRandom(forceGeneral = false) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await SessionsAPI.randomEntry(forceGeneral);
      if (result.allotted) {
        setMessage(
          `${result.plateNormalized} → ${result.slot.code} in ${result.base.name} (${result.sessionType})`
        );
        setSelectedBaseId(result.base.id);
      } else {
        setError(result.reason || 'Could not allot slot');
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
          <h2>Live lot map</h2>
          <p>Three bases · 50 car + 30 bike slots each · realtime occupancy</p>
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
          <span>Free now</span>
          <strong>{totals.free_slots ?? '—'}</strong>
        </div>
        <div className="stat">
          <span>Occupied</span>
          <strong>{totals.occupied_slots ?? '—'}</strong>
        </div>
        <div className="stat">
          <span>Active sessions</span>
          <strong>{totals.active_sessions ?? '—'}</strong>
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
              {base.base_type} · Car {base.car_free}/{base.car_total} · Bike {base.bike_free}/
              {base.bike_total}
            </div>
          </button>
        ))}
      </div>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="scan-result success">{message}</div> : null}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3>{occupancy?.base?.name || 'Select a base'}</h3>
            <span className="badge">{occupancy?.base?.base_type}</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {occupancy?.base?.description ||
              'Registered company plates go to company bases. Everyone else lands in general parking.'}
          </p>

          <div className="slot-section">
            <h4>
              <span className="legend-dot" style={{ background: 'var(--car)' }} />
              Car slots · {occupancy?.summary?.car?.free ?? 0} free /{' '}
              {occupancy?.summary?.car?.total ?? 0}
            </h4>
            <div className="slot-grid">
              {cars.map((slot) => (
                <SlotCell key={slot.id} slot={slot} />
              ))}
            </div>
          </div>

          <div className="slot-section">
            <h4>
              <span className="legend-dot" style={{ background: 'var(--bike)' }} />
              Bike slots · {occupancy?.summary?.bike?.free ?? 0} free /{' '}
              {occupancy?.summary?.bike?.total ?? 0}
            </h4>
            <div className="slot-grid">
              {bikes.map((slot) => (
                <SlotCell key={slot.id} slot={slot} />
              ))}
            </div>
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Base snapshot</h3>
            </div>
            <div className="stack">
              {(overview?.byBase || []).map((b) => (
                <div key={b.id} className="scan-result">
                  <strong>{b.name}</strong>
                  <span className="muted">
                    {b.base_type} · Occupied {b.occupied}
                  </span>
                  <span>
                    Cars free {b.car_free}/{b.car_total} · Bikes free {b.bike_free}/{b.bike_total}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Recent allotments</h3>
            </div>
            <div className="stack">
              {(overview?.recent || []).slice(0, 8).map((row) => (
                <div key={row.id} className="scan-result">
                  <strong>{row.plate_normalized}</strong>
                  <span>
                    {row.slot_code || '—'} · {row.base_name}
                  </span>
                  <span className="muted">
                    {row.vehicle_type} · {row.session_type} · {row.status}
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
