import { useCallback, useEffect, useRef, useState } from 'react';
import { AlprAPI, BasesAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useCamera } from '../hooks/useCamera';
import { useSocket } from '../hooks/useSocket';

export default function CheckIn() {
  const canvasRef = useRef(null);
  const lastPlateRef = useRef('');
  const stableCountRef = useRef(0);
  const scanningRef = useRef(false);
  const { videoRef, cameraOn, cameraError, startCamera, stopCamera, setCameraError } = useCamera();

  const [bases, setBases] = useState([]);
  const [baseId, setBaseId] = useState('');
  const [vehicleType, setVehicleType] = useState('CAR');
  const [autoScan, setAutoScan] = useState(true);
  const [detectedPlate, setDetectedPlate] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Starting check-in camera…');
  const [popup, setPopup] = useState({ open: false, title: '', lines: [] });

  const onCheckinSuccess = useCallback((payload) => {
    if (!payload?.allotted) return;
    setResult(payload);
    setDetectedPlate(payload.plateNormalized || '');
    setPopup({
      open: true,
      title: 'Check-in success',
      lines: [
        `Plate ${payload.plateNormalized}`,
        `Slot ${payload.slot?.code} · ${payload.base?.name}`,
        payload.vehicle?.company
          ? `${payload.vehicle.member || 'Member'} · ${payload.vehicle.company}`
          : 'Guest parking · Basement 1 General',
        payload.allotmentNote || '',
      ].filter(Boolean),
    });
  }, []);

  const { live } = useSocket({
    'checkin.success': onCheckinSuccess,
  });

  useEffect(() => {
    BasesAPI.list()
      .then((list) => {
        setBases(list);
        const general = list.find((b) => b.base_kind === 'GENERAL') || list[0];
        if (general) setBaseId(String(general.id));
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await startCamera();
      if (!cancelled) setStatus('Auto-scan ON — show number plate');
    })();
    return () => {
      cancelled = true;
    };
  }, [startCamera]);

  useEffect(() => {
    if (cameraError) setError(cameraError);
  }, [cameraError]);

  function captureFrameBase64() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    const maxW = 960;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  async function scanOnce() {
    const imageBase64 = captureFrameBase64();
    if (!imageBase64 || scanningRef.current) return null;
    scanningRef.current = true;
    try {
      const data = await AlprAPI.scan({ imageBase64 });
      if (data.plate) {
        setDetectedPlate(data.plate);
        setConfidence(data.confidence || 0);
        setStatus(`Detected ${data.plate}`);
      } else {
        setStatus(data.message || 'Looking for plate…');
      }
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      scanningRef.current = false;
    }
  }

  async function checkIn(plateOverride) {
    const plate = (plateOverride || detectedPlate || '').trim().toUpperCase();
    if (!plate || scanningRef.current) return;
    scanningRef.current = true;
    setError('');
    try {
      const data = await AlprAPI.checkIn({
        plate,
        vehicleType,
        baseId: baseId ? Number(baseId) : undefined,
        confidence: confidence || 0.9,
        source: 'WEBCAM',
      });
      setResult(data);
      if (data.allotted) onCheckinSuccess(data);
      else setError(data.reason || 'Could not allot slot');
    } catch (err) {
      setError(err.message);
    } finally {
      scanningRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoScan || !cameraOn) return undefined;
    const id = setInterval(async () => {
      const data = await scanOnce();
      if (!data?.plate) {
        stableCountRef.current = 0;
        lastPlateRef.current = '';
        return;
      }
      if (data.plate === lastPlateRef.current) stableCountRef.current += 1;
      else {
        lastPlateRef.current = data.plate;
        stableCountRef.current = 1;
      }
      if (stableCountRef.current >= 2 && (data.confidence || 0) >= 0.7) {
        setStatus(`Stable ${data.plate} — checking in…`);
        await checkIn(data.plate);
        stableCountRef.current = 0;
      }
    }, 1600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, cameraOn, vehicleType, baseId]);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Check-in gate</h2>
          <p>Eastface basement entry · auto webcam scan · company / guest allotment</p>
        </div>
        <span className="live-pill">
          <i />
          {live ? status : 'Connecting…'}
        </span>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3>Entry camera</h3>
            <div className="actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={async () => {
                  if (cameraOn) stopCamera();
                  else {
                    setCameraError('');
                    setError('');
                    await startCamera();
                    setStatus('Auto-scan ON — show number plate');
                  }
                }}
              >
                {cameraOn ? 'Stop cam' : 'Start cam'}
              </button>
              <button className="btn btn-primary" type="button" onClick={() => setAutoScan((v) => !v)}>
                {autoScan ? 'Auto-scan ON' : 'Auto-scan OFF'}
              </button>
            </div>
          </div>
          <div className="webcam-frame">
            <video ref={videoRef} playsInline muted className="webcam-video" />
            <div className="webcam-guide" />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="actions" style={{ marginTop: 12 }}>
            <label>
              Hint basement
              <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                <option value="CAR">Car</option>
                <option value="BIKE">Bike</option>
              </select>
            </label>
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Scanned plate</h3>
            </div>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                checkIn();
              }}
            >
              <label>
                Number plate
                <input
                  value={detectedPlate}
                  onChange={(e) => setDetectedPlate(e.target.value.toUpperCase())}
                  placeholder="GJ01YK1001"
                />
              </label>
              <div className="muted">Confidence {Math.round((confidence || 0) * 100)}%</div>
              <div className="actions">
                <button className="btn btn-secondary" type="button" onClick={scanOnce}>
                  Scan now
                </button>
                <button className="btn btn-primary" type="submit">
                  Check in
                </button>
              </div>
            </form>
            <p className="muted" style={{ marginTop: 12 }}>
              Demo York IE plates: <b>GJ01YK1001</b>, <b>GJ01YK2044</b>. Unknown plate → Basement 1 General.
            </p>
          </section>

          {result?.allotted ? (
            <section className="panel">
              <div className="scan-result success">
                <strong>Last allotment</strong>
                <div>
                  {result.plateNormalized} → <b>{result.slot?.code}</b>
                </div>
                <div>
                  {result.base?.name} · {result.sessionType}
                </div>
                <div className="muted">{result.allotmentNote}</div>
              </div>
            </section>
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
