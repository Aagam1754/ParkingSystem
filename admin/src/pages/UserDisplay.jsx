import { useCallback, useEffect, useRef, useState } from 'react';
import { BasesAPI, DashboardAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useSocket } from '../hooks/useSocket';
import { formatPlate } from '../utils/plates';

function SlotCell({ slot, blinkId, color }) {
  const blinking = blinkId && slot.id === blinkId;
  const occupied = slot.status === 'OCCUPIED';
  const plate = formatPlate(slot.plate_normalized);
  return (
    <div
      className={`slot display-slot ${slot.vehicle_type.toLowerCase()} ${slot.status} ${
        blinking ? 'slot-blink' : ''
      }`}
      title={occupied ? `${slot.code} · ${plate}` : slot.code}
      style={{
        borderColor: color,
        boxShadow: blinking ? `0 0 0 3px ${color}, 0 0 28px ${color}aa` : undefined,
        background:
          occupied
            ? `linear-gradient(160deg, ${color}66, rgba(255,93,93,0.28))`
            : `linear-gradient(160deg, ${color}33, rgba(61,255,168,0.12))`,
      }}
    >
      <strong>{slot.code}</strong>
      <small>{occupied ? plate || '—' : 'Free'}</small>
    </div>
  );
}

export default function UserDisplay() {
  const blinkTimerRef = useRef(null);
  const [building, setBuilding] = useState(null);
  const [bases, setBases] = useState([]);
  const [selectedBaseId, setSelectedBaseId] = useState(null);
  const [occupancy, setOccupancy] = useState(null);
  const [latest, setLatest] = useState(null);
  const [blinkId, setBlinkId] = useState(null);
  const [highlightMode, setHighlightMode] = useState(false);
  const [error, setError] = useState('');
  const [popup, setPopup] = useState({ open: false, title: '', lines: [] });
  const closePopup = useCallback(() => {
    setPopup((p) => ({ ...p, open: false }));
  }, []);

  const loadBase = useCallback(async (baseId) => {
    if (!baseId) return;
    setSelectedBaseId(baseId);
    setOccupancy(await BasesAPI.occupancy(baseId));
  }, []);

  const bootstrap = useCallback(async () => {
    const [list, bld] = await Promise.all([BasesAPI.list(), DashboardAPI.building()]);
    setBases(list);
    setBuilding(bld);
    const id = selectedBaseId || list[0]?.id;
    if (id) await loadBase(id);
  }, [loadBase, selectedBaseId]);

  useEffect(() => {
    bootstrap().catch((err) => setError(err.message));
    const poll = setInterval(() => {
      if (selectedBaseId) loadBase(selectedBaseId).catch(() => {});
    }, 5000);
    return () => clearInterval(poll);
  }, [bootstrap, loadBase, selectedBaseId]);

  const onCheckin = useCallback(
    async (payload) => {
      if (!payload?.allotted) return;
      setLatest(payload);
      setHighlightMode(true);
      setBlinkId(payload.slot?.id || null);

      // Jump visual to the allotted basement (e.g. B3) automatically
      if (payload.base?.id) {
        try {
          await loadBase(payload.base.id);
        } catch {
          /* ignore */
        }
      }

      setPopup({
        open: true,
        title: 'Parking allotted',
        lines: [
          `Welcome${payload.vehicle?.member ? `, ${payload.vehicle.member}` : ''}`,
          `Plate ${formatPlate(payload.plateNormalized)}`,
          `Your slot: ${payload.slot?.code}`,
          payload.base?.name || '',
          payload.vehicle?.company || 'General Parking',
        ].filter(Boolean),
      });

      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      // Blink allotted slot for 5s; popup auto-closes separately in 1s
      blinkTimerRef.current = setTimeout(() => {
        setBlinkId(null);
        setHighlightMode(false);
      }, 5000);
    },
    [loadBase]
  );

  useEffect(
    () => () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    },
    []
  );

  const onCheckout = useCallback(
    async (payload) => {
      if (!payload?.closed && !payload?.session) return;
      const plate = formatPlate(payload.session?.plate_normalized || payload.plateNormalized || '');
      const slotCode = payload.slot?.code;
      setPopup({
        open: true,
        title: 'Check-out successful',
        lines: [
          plate ? `Plate ${plate}` : '',
          slotCode ? `Slot ${slotCode} freed` : 'Parking slot freed',
          'Thank you — drive safe',
        ].filter(Boolean),
      });
      if (selectedBaseId) {
        try {
          await loadBase(selectedBaseId);
        } catch {
          /* ignore */
        }
      }
    },
    [loadBase, selectedBaseId]
  );

  const { live } = useSocket({
    'checkin.success': onCheckin,
    'checkout.success': onCheckout,
    'occupancy.updated': () => {
      if (selectedBaseId) loadBase(selectedBaseId).catch(() => {});
    },
  });

  const groups = occupancy?.groups || [];
  // During highlight, put the allotted company group first
  const orderedGroups = [...groups].sort((a, b) => {
    if (!latest?.slot) return 0;
    const aHas = [...a.cars, ...a.bikes].some((s) => s.id === latest.slot.id);
    const bHas = [...b.cars, ...b.bikes].some((s) => s.id === latest.slot.id);
    return Number(bHas) - Number(aHas);
  });

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
          {live ? (highlightMode ? 'New allotment · blinking 5s' : 'Live auto-updating') : 'Connecting…'}
        </span>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <div className="base-tabs">
        {bases.map((base) => (
          <button
            key={base.id}
            type="button"
            className={`base-tab ${selectedBaseId === base.id ? 'active' : ''}`}
            onClick={() => loadBase(base.id).catch((e) => setError(e.message))}
          >
            {base.name}
          </button>
        ))}
      </div>

      <div className="display-grid">
        <section className={`panel display-map ${highlightMode ? 'highlight-base' : ''}`}>
          <div className="panel-header">
            <h3>{occupancy?.base?.name || 'Basement'}</h3>
            <span className="muted">
              Free {occupancy?.summary?.free ?? 0}/{occupancy?.summary?.total ?? 0}
            </span>
          </div>

          {orderedGroups.map((group) => (
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
                    <SlotCell key={slot.id} slot={slot} blinkId={blinkId} color={group.colorHex} />
                  ))}
                </div>
              </div>
              <div className="slot-section">
                <h4>Bikes</h4>
                <div className="slot-grid">
                  {group.bikes.map((slot) => (
                    <SlotCell key={slot.id} slot={slot} blinkId={blinkId} color={group.colorHex} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>

        <aside className="panel display-side">
          <div className="panel-header">
            <h3>Your parking</h3>
          </div>
          <div className={`plate-board ${latest ? 'has-plate' : ''}`}>
            <div className="muted">Scanned number plate</div>
            <div className="plate-huge">
              {latest?.plateNormalized ? formatPlate(latest.plateNormalized) : 'WAITING'}
            </div>
          </div>

          <div className="scan-result" style={{ marginTop: 16 }}>
            <div className="muted">Allotted slot</div>
            <div
              className={`slot-huge ${blinkId ? 'slot-blink' : ''}`}
              style={{ color: latest?.slot?.companyColor || '#d6ff4b' }}
            >
              {latest?.slot?.code || '—'}
            </div>
            <div style={{ marginTop: 10 }}>
              <b>{latest?.base?.name || 'Waiting for check-in…'}</b>
            </div>
            <div>{latest?.vehicle?.company || latest?.sessionType || ''}</div>
            <div className="muted">{latest?.vehicle?.member || ''}</div>
            <div className="muted">{latest?.allotmentNote || ''}</div>
          </div>
        </aside>
      </div>

      <SuccessPopup
        open={popup.open}
        title={popup.title}
        lines={popup.lines}
        autoCloseMs={1000}
        onClose={closePopup}
      />
    </div>
  );
}
