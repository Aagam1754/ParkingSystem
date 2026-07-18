import { useCallback, useEffect, useRef, useState } from 'react';
import { AlprAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useCamera } from '../hooks/useCamera';
import { useSocket } from '../hooks/useSocket';

export default function CheckIn() {
  const canvasRef = useRef(null);
  const lastPlateRef = useRef('');
  const stableCountRef = useRef(0);
  const scanningRef = useRef(false);
  const cooldownPlateRef = useRef('');
  const cooldownUntilRef = useRef(0);
  const { videoRef, cameraOn, cameraError, startCamera, stopCamera, setCameraError } = useCamera();

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
    cooldownPlateRef.current = payload.plateNormalized || '';
    cooldownUntilRef.current = Date.now() + 12000;
    setPopup({
      open: true,
      title: 'Check-in success',
      lines: [
        `Plate ${payload.plateNormalized}`,
        `Slot ${payload.slot?.code}`,
        payload.base?.name || '',
        payload.vehicle?.company
          ? `${payload.vehicle.member || 'Member'} · ${payload.vehicle.company}`
          : 'Guest · Basement 1 General',
        payload.allotmentNote || '',
      ].filter(Boolean),
    });
    setStatus(`Allotted ${payload.slot?.code} for ${payload.plateNormalized}`);
  }, []);

  const { live } = useSocket({
    'checkin.success': onCheckinSuccess,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await startCamera();
      if (!cancelled) setStatus('Auto-scan ON — show number plate in yellow box');
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
    const maxW = 1100;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
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
        setStatus(
          data.matchedRegistered
            ? `Registered plate ${data.plate}`
            : `Detected ${data.plate}`
        );
        setError('');
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

  async function checkInFromFrame(plateHint) {
    if (scanningRef.current) return;
    const now = Date.now();
    if (
      plateHint &&
      plateHint === cooldownPlateRef.current &&
      now < cooldownUntilRef.current
    ) {
      setStatus(`Already checked in ${plateHint}`);
      return;
    }

    scanningRef.current = true;
    setError('');
    try {
      const imageBase64 = captureFrameBase64();
      const data = await AlprAPI.checkIn({
        plate: plateHint || detectedPlate || undefined,
        imageBase64: imageBase64 || undefined,
        source: 'WEBCAM',
      });
      setResult(data);
      if (data.allotted) onCheckinSuccess(data);
      else setError(data.reason || 'Could not allot slot');
    } catch (err) {
      // Don't spam scary errors for already-parked during auto-scan
      if (/already checked in/i.test(err.message)) {
        setStatus(err.message);
        cooldownPlateRef.current = plateHint || detectedPlate;
        cooldownUntilRef.current = Date.now() + 12000;
      } else {
        setError(err.message);
      }
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
        return;
      }
      if (data.plate === lastPlateRef.current) stableCountRef.current += 1;
      else {
        lastPlateRef.current = data.plate;
        stableCountRef.current = 1;
      }
      // 1 stable read is enough when registered match; else need 2
      const need = data.matchedRegistered || (data.confidence || 0) >= 0.85 ? 1 : 2;
      if (stableCountRef.current >= need && (data.confidence || 0) >= 0.45) {
        setStatus(`Checking in ${data.plate}…`);
        await checkInFromFrame(data.plate);
        stableCountRef.current = 0;
      }
    }, 1200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, cameraOn]);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Check-in gate</h2>
          <p>
            Auto plate scan → identify company from DB → allot correct slot (no basement selection)
          </p>
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
          <p className="muted" style={{ marginTop: 10 }}>
            Hold plate inside the yellow box. System finds company + free slot automatically.
          </p>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Live scan result</h3>
            </div>
            <div className={`plate-board ${detectedPlate ? 'has-plate' : ''}`}>
              <div className="muted">Number plate</div>
              <div className="plate-huge">{detectedPlate || 'SCANNING…'}</div>
              <div className="muted">Confidence {Math.round((confidence || 0) * 100)}%</div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary" type="button" onClick={scanOnce}>
                Scan now
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => checkInFromFrame(detectedPlate)}
              >
                Check in now
              </button>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              York IE demo: <b>GJ01YK1001</b>, <b>GJ01YK2044</b>
            </p>
          </section>

          {result?.allotted ? (
            <section className="panel allot-card">
              <div className="panel-header">
                <h3>Allotted parking</h3>
              </div>
              <div className="slot-huge slot-blink" style={{ color: result.slot?.companyColor || '#d6ff4b' }}>
                {result.slot?.code}
              </div>
              <div className="scan-result success" style={{ marginTop: 10 }}>
                <div>
                  <b>{result.base?.name}</b> ({result.base?.code})
                </div>
                <div>
                  Plate <b>{result.plateNormalized}</b>
                </div>
                <div>
                  {result.vehicle?.company || 'General Parking'}
                  {result.vehicle?.member ? ` · ${result.vehicle.member}` : ''}
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
