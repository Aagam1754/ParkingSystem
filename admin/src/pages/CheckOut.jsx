import { useCallback, useEffect, useRef, useState } from 'react';
import { AlprAPI } from '../api';
import SuccessPopup from '../components/SuccessPopup';
import { useSocket } from '../hooks/useSocket';

export default function CheckOut() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastPlateRef = useRef('');
  const stableCountRef = useRef(0);
  const scanningRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [detectedPlate, setDetectedPlate] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Check-out camera ready');
  const [popup, setPopup] = useState({ open: false, title: '', lines: [] });

  const onCheckoutSuccess = useCallback((payload) => {
    if (!payload?.closed) return;
    setResult(payload);
    setPopup({
      open: true,
      title: 'Check-out success',
      lines: [
        `Plate ${payload.session?.plate_normalized || detectedPlate}`,
        'Slot freed · session closed',
        'Thank you — drive safe',
      ],
    });
  }, [detectedPlate]);

  const { live } = useSocket({
    'checkout.success': onCheckoutSuccess,
  });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks()?.forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function startCamera() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setAutoScan(true);
      setStatus('Auto-scan ON — show plate to exit');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      } else setStatus(data.message || 'Looking for plate…');
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      scanningRef.current = false;
    }
  }

  async function checkOut(plateOverride) {
    const plate = (plateOverride || detectedPlate || '').trim().toUpperCase();
    if (!plate || scanningRef.current) return;
    scanningRef.current = true;
    setError('');
    try {
      const data = await AlprAPI.checkOut({ plate, confidence: confidence || 0.9, source: 'WEBCAM' });
      setResult(data);
      onCheckoutSuccess(data);
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
        setStatus(`Stable ${data.plate} — checking out…`);
        await checkOut(data.plate);
        stableCountRef.current = 0;
      }
    }, 1600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, cameraOn]);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Check-out gate</h2>
          <p>Eastface exit lane · scan plate to free slot</p>
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
              <button className="btn btn-secondary" type="button" onClick={cameraOn ? stopCamera : startCamera}>
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
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Exit plate</h3>
            </div>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                checkOut();
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
              <div className="actions">
                <button className="btn btn-secondary" type="button" onClick={scanOnce}>
                  Scan now
                </button>
                <button className="btn btn-danger" type="submit">
                  Check out
                </button>
              </div>
            </form>
          </section>

          {result?.closed ? (
            <section className="panel">
              <div className="scan-result success">
                <strong>Last exit</strong>
                <div>{result.session?.plate_normalized}</div>
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
        onClose={() => setPopup((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}
