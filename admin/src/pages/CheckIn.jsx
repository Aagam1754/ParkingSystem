import { useCallback, useEffect, useRef, useState } from 'react';
import { AlprAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useCamera } from '../hooks/useCamera';
import { useSocket } from '../hooks/useSocket';

export default function CheckIn() {
  const canvasRef = useRef(null);
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
      if (!cancelled) setStatus('Waiting for plate in yellow box…');
    })();
    return () => {
      cancelled = true;
    };
  }, [startCamera]);

  useEffect(() => {
    if (cameraError) setError(cameraError);
  }, [cameraError]);

  /** Capture yellow-guide crop (preferred) + full frame. */
  function captureFrames() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return [];

    const drawAndEncode = (sx, sy, sw, sh, outW) => {
      const scale = Math.min(1, outW / sw);
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    };

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // Must match .webcam-guide CSS: left/right 10%, top 30%, bottom 28%
    const gx = Math.floor(vw * 0.1);
    const gy = Math.floor(vh * 0.3);
    const gw = Math.floor(vw * 0.8);
    const gh = Math.floor(vh * 0.42);
    return [
      drawAndEncode(gx, gy, gw, gh, 900),
      drawAndEncode(0, 0, vw, vh, 960),
    ];
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

      setStatus('Scanning plate from camera…');
      let scanned = await AlprAPI.scan({ imageBase64: frames[0] });
      if (!scanned?.plate && scanned?.engine !== 'busy' && frames[1]) {
        scanned = await AlprAPI.scan({ imageBase64: frames[1] });
      }
      if (scanned?.engine === 'busy') {
        setStatus('Scanner catching up — keep plate in the yellow box');
        return;
      }

      if (scanned?.plate) {
        setDetectedPlate(scanned.plate);
        setConfidence(scanned.confidence || 0);
        setOcrHint(scanned.message || '');
        setError('');

        const plate = scanned.plate;
        if (plate === cooldownPlateRef.current && Date.now() < cooldownUntilRef.current) {
          setStatus(`Already handled ${plate} — show another plate or check out first`);
          return;
        }

        setStatus(`Plate ${plate} — allocating slot…`);
        // Camera image required — backend rejects plate-only check-in for WEBCAM
        const data = await AlprAPI.checkIn({
          imageBase64: frames[0],
          source: 'WEBCAM',
        });
        setResult(data);
        if (data.allotted) onCheckinSuccess(data);
        else setStatus(data.reason || 'Not allotted');
      } else {
        setStatus('No plate on camera yet — slot waits for a successful scan');
        setOcrHint(scanned?.rawText?.slice(0, 80) || scanned?.message || '');
      }
    } catch (err) {
      if (/already checked in/i.test(err.message)) {
        setStatus(err.message);
        setError(err.message);
        cooldownPlateRef.current = detectedPlate;
        cooldownUntilRef.current = Date.now() + 15000;
      } else if (/timed out|Could not read number plate/i.test(err.message)) {
        setStatus('Could not read plate — hold steadier in the yellow box');
        setOcrHint(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      scanningRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoScan || !cameraOn) return undefined;
    autoCycle();
    const id = setInterval(() => {
      autoCycle();
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, cameraOn]);

  async function manualCheckIn() {
    scanningRef.current = false;
    await autoCycle();
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Check-in gate</h2>
          <p>Slot is allotted only after the camera reads a number plate. No plate scan → no slot.</p>
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
                    setStatus('Waiting for plate in yellow box…');
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
              Scan camera now
            </button>
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Live scan result</h3>
            </div>
            <div className={`plate-board ${detectedPlate ? 'has-plate' : ''}`}>
              <div className="muted">Number plate (from camera)</div>
              <div className="plate-huge">{detectedPlate || 'WAITING…'}</div>
              <div className="muted">Confidence {Math.round((confidence || 0) * 100)}%</div>
              {ocrHint ? <div className="muted" style={{ marginTop: 8 }}>OCR: {ocrHint}</div> : null}
            </div>
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
        autoCloseMs={1000}
        onClose={() => setPopup((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}
