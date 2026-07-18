import { useState } from 'react';
import { SessionsAPI } from '../api';

const SAMPLE_REGISTERED = [
  { plate: 'GJ01YK1001', vehicleType: 'CAR', note: 'York IE · Priya Sharma' },
  { plate: 'GJ01YK2044', vehicleType: 'CAR', note: 'York IE · Arjun Mehta' },
  { plate: 'GJ01YK1002', vehicleType: 'BIKE', note: 'York IE · Priya Sharma' },
  { plate: 'MH12AB1234', vehicleType: 'CAR', note: 'Nexus · Aisha' },
  { plate: 'GJ01GH3456', vehicleType: 'CAR', note: 'Orbit · Meera' },
];

export default function ScanDesk() {
  const [plate, setPlate] = useState('GJ01YK1001');
  const [vehicleType, setVehicleType] = useState('CAR');
  const [confidence, setConfidence] = useState(0.93);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onEntry(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await SessionsAPI.entryScan({
        plate,
        vehicleType,
        confidence: Number(confidence),
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onExit() {
    setLoading(true);
    setError('');
    try {
      const data = await SessionsAPI.exitScan({ plate, confidence: Number(confidence) });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function randomGuest() {
    setLoading(true);
    setError('');
    try {
      const data = await SessionsAPI.randomEntry(true);
      setResult(data);
      if (data.plateNormalized) setPlate(data.plateNormalized);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Plate scan desk</h2>
          <p>
            Camera reads the plate → verify in DB → company slot if registered, else general Base 1
          </p>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3>Entry / exit console</h3>
          </div>
          <form className="form" onSubmit={onEntry}>
            <label>
              Number plate
              <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} required />
            </label>
            <label>
              Vehicle type
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                <option value="CAR">Car</option>
                <option value="BIKE">Bike</option>
              </select>
            </label>
            <label>
              ALPR confidence
              <input
                type="number"
                min="0.5"
                max="1"
                step="0.01"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
              />
            </label>

            <div className="actions">
              <button className="btn btn-primary" disabled={loading} type="submit">
                Scan entry & allot
              </button>
              <button className="btn btn-secondary" disabled={loading} type="button" onClick={onExit}>
                Scan exit
              </button>
              <button
                className="btn btn-secondary"
                disabled={loading}
                type="button"
                onClick={randomGuest}
              >
                Random guest plate
              </button>
            </div>
          </form>

          {error ? <div className="error" style={{ marginTop: 14 }}>{error}</div> : null}

          {result ? (
            <div className="scan-result" style={{ marginTop: 14 }}>
              {result.allotted ? (
                <>
                  <strong className="success">Slot allotted</strong>
                  <div>
                    Plate <b>{result.plateNormalized}</b> → <b>{result.slot?.code}</b>
                  </div>
                  <div>
                    Base: {result.base?.name} ({result.base?.type})
                  </div>
                  <div>Session: {result.sessionType}</div>
                  <div className="muted">{result.allotmentNote}</div>
                  {result.vehicle ? (
                    <div>
                      Registered to {result.vehicle.member} · {result.vehicle.company}
                    </div>
                  ) : (
                    <div>Unregistered vehicle → general parking</div>
                  )}
                </>
              ) : result.closed ? (
                <>
                  <strong className="success">Session closed</strong>
                  <div>Plate {result.session?.plate_normalized} exited successfully</div>
                </>
              ) : (
                <>
                  <strong>Not allotted</strong>
                  <div>{result.reason || 'See response for details'}</div>
                </>
              )}
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Registered demo plates</h3>
          </div>
          <p className="muted">
            Click a plate to load it. These go to company bases (Nexus / Orbit). Unknown plates go to
            Base 1 · General.
          </p>
          <div className="stack">
            {SAMPLE_REGISTERED.map((item) => (
              <button
                key={item.plate}
                type="button"
                className="btn btn-secondary"
                style={{ textAlign: 'left' }}
                onClick={() => {
                  setPlate(item.plate);
                  setVehicleType(item.vehicleType);
                }}
              >
                <strong>{item.plate}</strong>
                <div className="muted">
                  {item.vehicleType} · {item.note}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
