import { useCallback, useEffect, useMemo, useState } from 'react';
import { BasesAPI, DashboardAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useSocket } from '../hooks/useSocket';

function SlotCell({ slot, blinkId, color }) {
  const blinking = blinkId && slot.id === blinkId;
  return (
    <div
      className={`slot display-slot ${slot.vehicle_type.toLowerCase()} ${slot.status} ${
        blinking ? 'slot-blink' : ''
      }`}
      style={{
        borderColor: color,
        boxShadow: blinking ? `0 0 0 2px ${color}, 0 0 24px ${color}88` : undefined,
        background:
          slot.status === 'OCCUPIED'
            ? `linear-gradient(160deg, ${color}55, rgba(255,93,93,0.25))`
            : `linear-gradient(160deg, ${color}33, rgba(61,255,168,0.12))`,
      }}
    >
      <strong>{slot.code}</strong>
      <small>{slot.status === 'OCCUPIED' ? slot.plate_normalized || 'Busy' : 'Free'}</small>
    </div>
  );
}

export default function UserDisplay() {
  const [building, setBuilding] = useState(null);
  const [bases, setBases] = useState([]);
  const [selectedBaseId, setSelectedBaseId] = useState(null);
  const [occupancy, setOccupancy] = useState(null);
  const [latest, setLatest] = useState(null);
  const [blinkId, setBlinkId] = useState(null);
  const [error, setError] = useState('');
  const [popup, setPopup] = useState({ open: false, title: '', lines: [] });

  const load = useCallback(async (baseId) => {
    const [list, bld] = await Promise.all([BasesAPI.list(), DashboardAPI.building()]);
    setBases(list);
    setBuilding(bld);
    const id = baseId || selectedBaseId || list[0]?.id;
    if (id) {
      setSelectedBaseId(id);
      setOccupancy(await BasesAPI.occupancy(id));
    }
  }, [selectedBaseId]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
    const poll = setInterval(() => {
      load(selectedBaseId).catch(() => {});
    }, 4000);
    return () => clearInterval(poll);
  }, [load, selectedBaseId]);

  const onCheckin = useCallback(
    (payload) => {
      if (!payload?.allotted) return;
      setLatest(payload);
      setBlinkId(payload.slot?.id || null);
      if (payload.base?.id) {
        setSelectedBaseId(payload.base.id);
        BasesAPI.occupancy(payload.base.id)
          .then(setOccupancy)
          .catch(() => {});
      }
      setPopup({
        open: true,
        title: 'Parking allotted',
        lines: [
          `Welcome${payload.vehicle?.member ? `, ${payload.vehicle.member}` : ''}`,
          `Plate ${payload.plateNormalized}`,
          `Your slot: ${payload.slot?.code}`,
          payload.base?.name || '',
          payload.vehicle?.company || 'General Parking',
        ].filter(Boolean),
      });
      // keep blink for a while
      setTimeout(() => setBlinkId(null), 12000);
    },
    []
  );

  const { live } = useSocket({
    'checkin.success': onCheckin,
    'occupancy.updated': () => load(selectedBaseId).catch(() => {}),
    'session.updated': () => load(selectedBaseId).catch(() => {}),
  });

  const activeGroup = useMemo(() => {
    if (!latest?.slot || !occupancy?.groups) return occupancy?.groups?.[0] || null;
    return (
      occupancy.groups.find((g) =>
        [...g.cars, ...g.bikes].some((s) => s.id === latest.slot.id)
      ) || occupancy.groups[0]
    );
  }, [latest, occupancy]);

  return (
    <div className="display-screen">
      <header className="display-header">
        <div>
          <div className="muted">Building</div>
          <h1>{building?.name || 'Eastface'}</h1>
          <p className="muted">
            {building
              ? `${building.address}, ${building.city}, ${building.state} ${building.pincode}`
              : 'Smart parking display'}
          </p>
        </div>
        <span className="live-pill">
          <i />
          {live ? 'Live auto-updating' : 'Connecting…'}
        </span>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <div className="base-tabs">
        {bases.map((base) => (
          <button
            key={base.id}
            type="button"
            className={`base-tab ${selectedBaseId === base.id ? 'active' : ''}`}
            onClick={() => {
              setSelectedBaseId(base.id);
              BasesAPI.occupancy(base.id).then(setOccupancy).catch((e) => setError(e.message));
            }}
          >
            {base.name}
          </button>
        ))}
      </div>

      <div className="display-grid">
        <section className="panel display-map">
          <div className="panel-header">
            <h3>{occupancy?.base?.name || 'Basement'}</h3>
            <span className="muted">
              Free {occupancy?.summary?.free ?? 0}/{occupancy?.summary?.total ?? 0}
            </span>
          </div>

          {(occupancy?.groups || []).map((group) => (
            <div key={group.key} className="company-block" style={{ '--company': group.colorHex }}>
              <div className="company-block-head">
                <span className="company-swatch" style={{ background: group.colorHex }} />
                <strong>{group.companyName}</strong>
                <span className="badge">{group.companyCode}</span>
              </div>
              <div className="slot-section">
                <h4>Cars</h4>
                <div className="slot-grid">
                  {group.cars.map((slot) => (
                    <SlotCell
                      key={slot.id}
                      slot={slot}
                      blinkId={blinkId}
                      color={group.colorHex}
                    />
                  ))}
                </div>
              </div>
              <div className="slot-section">
                <h4>Bikes</h4>
                <div className="slot-grid">
                  {group.bikes.map((slot) => (
                    <SlotCell
                      key={slot.id}
                      slot={slot}
                      blinkId={blinkId}
                      color={group.colorHex}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>

        <aside className="panel display-side">
          <div className="panel-header">
            <h3>Scanned vehicle</h3>
          </div>
          <div className={`plate-board ${latest ? 'has-plate' : ''}`}>
            <div className="muted">Number plate</div>
            <div className="plate-huge">{latest?.plateNormalized || 'WAITING'}</div>
          </div>

          <div className="scan-result" style={{ marginTop: 16 }}>
            <div>
              <span className="muted">Allotted slot</span>
              <div className={`slot-huge ${blinkId ? 'slot-blink' : ''}`}>
                {latest?.slot?.code || '—'}
              </div>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              {latest?.base?.name || 'Show plate at check-in camera'}
            </div>
            <div>{latest?.vehicle?.company || latest?.sessionType || ''}</div>
            <div className="muted">{latest?.vehicle?.member || ''}</div>
            <div className="muted">{latest?.allotmentNote || ''}</div>
          </div>

          {activeGroup ? (
            <div className="scan-result" style={{ marginTop: 12 }}>
              <span className="company-swatch" style={{ background: activeGroup.colorHex }} />{' '}
              Highlight pool: <b>{activeGroup.companyName}</b>
            </div>
          ) : null}
        </aside>
      </div>

      <SuccessPopup
        open={popup.open}
        title={popup.title}
        lines={popup.lines}
        onClose={() => setPopup((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}
