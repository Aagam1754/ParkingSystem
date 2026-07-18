import { useCallback, useEffect, useRef, useState } from 'react';
import { AlprAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useCamera } from '../hooks/useCamera';
import { useSocket } from '../hooks/useSocket';

export default function CheckIn() {
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const scanningRef = useRef(false);
  const cooldownPlateRef = useRef('');
  const cooldownUntilRef = useRef(0);
  const { videoRef, cameraOn, cameraError, startCamera, stopCamera, setCameraError } = useCamera();

  const [autoScan, setAutoScan] = useState(true);
  const [detectedPlate, setDetectedPlate] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [ocrHint, setOcrHint] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Starting check-in camera…');
  const [popup, setPopup] = useState({ open: false, title: '', lines: [] });

  const onCheckinSuccess = useCallback((payload) => {
    if (!payload?.allotted) return;
    setResult(payload);
    setDetectedPlate(payload.plateNormalized || '');
    cooldownPlateRef.current = payload.plateNormalized || '';
    cooldownUntilRef.current = Date.now() + 15000;
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
      if (!cancelled) setStatus('Auto-scan ON — fill the yellow box with the plate');
    })();
    return () => {
      cancelled = true;
    };
  }, [startCamera]);

  useEffect(() => {
    if (cameraError) setError(cameraError);
  }, [cameraError]);

  /** Capture full frame + tight center crop (yellow guide) for better OCR. */
  function captureFrames() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return [];

    const frames = [];
    const drawAndEncode = (sx, sy, sw, sh, outW) => {
      const scale = outW / sw;
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.92);
    };

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // full frame
    frames.push(drawAndEncode(0, 0, vw, vh, 1100));
    // yellow guide region (~center band)
    const gx = Math.floor(vw * 0.1);
    const gy = Math.floor(vh * 0.32);
    const gw = Math.floor(vw * 0.8);
    const gh = Math.floor(vh * 0.4);
    frames.push(drawAndEncode(gx, gy, gw, gh, 1000));
    // tighter plate band
    const tx = Math.floor(vw * 0.18);
    const ty = Math.floor(vh * 0.38);
    const tw = Math.floor(vw * 0.64);
    const th = Math.floor(vh * 0.28);
    frames.push(drawAndEncode(tx, ty, tw, th, 900));
    return frames;
  }

  async function tryScanFrames(frames) {
    let best = null;
    for (const imageBase64 of frames) {
      try {
        const data = await AlprAPI.scan({ imageBase64 });
        if (data?.plate) {
          if (
            !best ||
            (data.matchedRegistered && !best.matchedRegistered) ||
            (data.confidence || 0) > (best.confidence || 0)
          ) {
            best = data;
          }
          if (data.matchedRegistered || (data.confidence || 0) >= 0.85) break;
        } else if (!best) {
          best = data;
        }
      } catch (err) {
        setOcrHint(err.message);
      }
    }
    return best;
  }

  async function autoCycle() {
    if (scanningRef.current || !cameraOn) return;
    scanningRef.current = true;
    try {
      const frames = captureFrames();
      if (!frames.length) {
        setStatus('Waiting for camera frame…');
        return;
      }

      setStatus('Scanning plate…');
      const scanned = await tryScanFrames(frames);
      if (scanned?.plate) {
        setDetectedPlate(scanned.plate);
        setConfidence(scanned.confidence || 0);
        setOcrHint(scanned.message || scanned.rawText?.slice(0, 80) || '');
        setError('');

        const plate = scanned.plate;
        if (
          plate === cooldownPlateRef.current &&
          Date.now() < cooldownUntilRef.current
        ) {
          setStatus(`Already checked in ${plate}`);
          return;
        }

        setStatus(`Plate ${plate} — checking in…`);
        // Direct check-in with best crop frame + plate hint
        const data = await AlprAPI.checkIn({
          plate,
          imageBase64: frames[1] || frames[0],
          source: 'WEBCAM',
        });
        setResult(data);
        if (data.allotted) onCheckinSuccess(data);
        else setStatus(data.reason || 'Not allotted');
      } else {
        setStatus(scanned?.message || 'Point plate at camera — still looking…');
        setOcrHint(scanned?.rawText?.slice(0, 100) || 'No plate text yet');
      }
    } catch (err) {
      if (/already checked in/i.test(err.message)) {
        setStatus(err.message);
        cooldownPlateRef.current = detectedPlate;
        cooldownUntilRef.current = Date.now() + 15000;
      } else if (/Could not read number plate/i.test(err.message)) {
        setStatus('Hold plate steady & closer in the yellow box');
      } else {
        setError(err.message);
      }
    } finally {
      scanningRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoScan || !cameraOn) return undefined;
    // Kick immediately, then every 1.1s
    autoCycle();
    const id = setInterval(() => {
      autoCycle();
    }, 1100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, cameraOn]);

  async function manualCheckIn() {
    scanningRef.current = false;
    await autoCycle();
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const imageBase64 = String(reader.result || '');
      setStatus('Scanning uploaded plate image…');
      setError('');
      try {
        const scanned = await AlprAPI.scan({ imageBase64 });
        if (scanned.plate) {
          setDetectedPlate(scanned.plate);
          setConfidence(scanned.confidence || 0);
        }
        const data = await AlprAPI.checkIn({
          plate: scanned.plate || undefined,
          imageBase64,
          source: 'WEBCAM',
        });
        setResult(data);
        if (data.allotted) onCheckinSuccess(data);
        else setError(data.reason || 'Not allotted');
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Check-in gate</h2>
          <p>Auto webcam scan every second → company from DB → allot slot</p>
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
                    setStatus('Auto-scan ON');
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
            Tips: max brightness on phone · plate fills yellow box · hold steady 1–2 seconds · avoid glare
          </p>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn btn-secondary" type="button" onClick={manualCheckIn}>
              Scan & check-in now
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => fileRef.current?.click()}>
              Upload plate photo
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
          </div>
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
              {ocrHint ? <div className="muted" style={{ marginTop: 8 }}>OCR: {ocrHint}</div> : null}
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              York IE demo plates: <b>GJ01YK1001</b>, <b>GJ01YK2044</b>
            </p>
            <p className="muted">
              Use photo from <b>docs/sample-plates/car-photo-GJ01YK1001.png</b> or Upload button if webcam OCR struggles.
            </p>
          </section>

          {result?.allotted ? (
            <section className="panel allot-card">
              <div className="panel-header">
                <h3>Allotted parking</h3>
              </div>
              <div
                className="slot-huge slot-blink"
                style={{ color: result.slot?.companyColor || '#d6ff4b' }}
              >
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
