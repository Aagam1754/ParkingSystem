import { useCallback, useEffect, useRef, useState } from 'react';
import { AlprAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useCamera } from '../hooks/useCamera';
import { useSocket } from '../hooks/useSocket';
import { canActOnScan } from '../utils/plateGate';
import { formatPlate } from '../utils/plates';

export default function CheckOut() {
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
  const [status, setStatus] = useState('Check-out camera ready');
  const [popup, setPopup] = useState({ open: false, title: '', lines: [] });

  const closePopup = useCallback(() => {
    setPopup((p) => ({ ...p, open: false }));
  }, []);

  const onCheckoutSuccess = useCallback((payload) => {
    if (!payload?.closed && !payload?.session) return;
    const plateRaw = payload.session?.plate_normalized || payload.plateNormalized || '';
    const plate = formatPlate(plateRaw);
    const slotCode = payload.session?.slot_code || payload.slot?.code;
    setResult(payload);
    setDetectedPlate(plateRaw);
    cooldownPlateRef.current = plateRaw;
    cooldownUntilRef.current = Date.now() + 15000;
    setError('');
    setStatus(`Checked out ${plate}`);
    setPopup({
      open: true,
      title: 'Check-out successful',
      lines: [
        plate ? `Plate ${plate}` : '',
        slotCode ? `Slot ${slotCode} freed` : 'Parking slot freed',
        'Session closed',
        'Thank you — drive safe',
      ].filter(Boolean),
    });
  }, []);

  const { live } = useSocket({
    'checkout.success': onCheckoutSuccess,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await startCamera();
      if (!cancelled) setStatus('Waiting for plate in yellow box to check out…');
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
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  async function autoCycle() {
    if (scanningRef.current || !cameraOn) return;
    scanningRef.current = true;
    try {
      const imageBase64 = captureFrameBase64();
      if (!imageBase64) {
        setStatus('Waiting for camera frame…');
        return;
      }

      const scanned = await AlprAPI.scan({ imageBase64 });
      if (scanned?.engine === 'busy') {
        setStatus('Scanner catching up…');
        return;
      }

      if (!canActOnScan(scanned)) {
        stableCountRef.current = 0;
        lastPlateRef.current = '';
        setDetectedPlate('');
        setConfidence(0);
        setStatus('Waiting — show a number plate to check out (no action yet)');
        setError('');
        return;
      }

      setDetectedPlate(scanned.plate);
      setConfidence(scanned.confidence || 0);

      lastPlateRef.current = scanned.plate;
      stableCountRef.current = 1;

      if (scanned.plate === cooldownPlateRef.current && Date.now() < cooldownUntilRef.current) {
        setStatus(`Already checked out ${formatPlate(scanned.plate)}`);
        return;
      }

      setStatus(`Plate ${formatPlate(scanned.plate)} — checking out…`);
      const data = await AlprAPI.checkOut({
        imageBase64,
        source: 'WEBCAM',
      });
      stableCountRef.current = 0;
      setResult(data);
      onCheckoutSuccess(data);
    } catch (err) {
      stableCountRef.current = 0;
      if (/No active check-in|No clear number plate|Could not read/i.test(err.message)) {
        setStatus(err.message);
        setError('');
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
    }, 2200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, cameraOn]);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Check-out gate</h2>
          <p>Slot frees only after the camera reads a clear number plate. Empty camera = no action.</p>
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
            <h3>Exit camera</h3>
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
                    setStatus('Waiting for plate in yellow box to check out…');
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
          <div className="actions" style={{ marginTop: 10 }}>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                scanningRef.current = false;
                autoCycle();
              }}
            >
              Scan camera now
            </button>
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Exit plate (from camera)</h3>
            </div>
            <div className={`plate-board ${detectedPlate ? 'has-plate' : ''}`}>
              <div className="muted">Number plate</div>
              <div className="plate-huge">{detectedPlate ? formatPlate(detectedPlate) : 'WAITING…'}</div>
              <div className="muted">Confidence {Math.round((confidence || 0) * 100)}%</div>
            </div>
          </section>

          {result?.closed ? (
            <section className="panel">
              <div className="scan-result success">
                <strong>Last exit</strong>
                <div>{formatPlate(result.session?.plate_normalized || result.plateNormalized)}</div>
                <div className="muted">Session closed · slot freed</div>
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      <SuccessPopup
        open={popup.open}
        title={popup.title}
        lines={popup.lines}
        tone="checkout"
        autoCloseMs={1000}
        onClose={closePopup}
      />
    </div>
  );
}
