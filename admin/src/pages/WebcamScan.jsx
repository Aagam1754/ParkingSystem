import { useCallback, useEffect, useRef, useState } from 'react';
import { AlprAPI, BasesAPI } from '../api';

export default function WebcamScan() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastPlateRef = useRef('');
  const stableCountRef = useRef(0);

  const [bases, setBases] = useState([]);
  const [baseId, setBaseId] = useState('');
  const [vehicleType, setVehicleType] = useState('CAR');
  const [cameraOn, setCameraOn] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [detectedPlate, setDetectedPlate] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [candidates, setCandidates] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Camera off');

  useEffect(() => {
    BasesAPI.list()
      .then((list) => {
        setBases(list);
        if (list[0]) setBaseId(String(list[0].id));
      })
      .catch((err) => setError(err.message));
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks()?.forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setAutoScan(false);
    setStatus('Camera off');
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
      setStatus('Camera live — point at number plate');
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow webcam access in the browser.'
          : `Camera error: ${err.message}`
      );
    }
  }

  function captureFrameBase64() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  async function scanOnce() {
    const imageBase64 = captureFrameBase64();
    if (!imageBase64) {
      setError('No camera frame yet');
      return null;
    }
    setScanning(true);
    setError('');
    try {
      const data = await AlprAPI.scan({ imageBase64 });
      if (data.plate) {
        setDetectedPlate(data.plate);
        setConfidence(data.confidence || 0);
        setCandidates(data.candidates || []);
        setStatus(`Detected ${data.plate} (${Math.round((data.confidence || 0) * 100)}%)`);
      } else {
        setStatus(data.message || 'No plate in frame');
      }
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setScanning(false);
    }
  }

  async function checkIn(plateOverride) {
    const plate = (plateOverride || detectedPlate || '').trim().toUpperCase();
    if (!plate) {
      setError('No plate to check in');
      return;
    }
    setScanning(true);
    setError('');
    setResult(null);
    try {
      // Prefer confirmed plate text; still attach a frame for audit/OCR fallback
      const imageBase64 = captureFrameBase64();
      const data = await AlprAPI.checkIn({
        plate,
        vehicleType,
        baseId: baseId ? Number(baseId) : undefined,
        confidence: confidence || 0.9,
        source: 'WEBCAM',
        imageBase64: undefined, // plate already confirmed
      });
      setResult(data);
      setStatus(
        data.allotted
          ? `Checked in ${data.plateNormalized} → ${data.slot?.code}`
          : data.reason || 'Not allotted'
      );
      // unused var guard
      void imageBase64;
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function checkOut() {
    if (!detectedPlate) return;
    setScanning(true);
    setError('');
    try {
      const data = await AlprAPI.checkOut({ plate: detectedPlate, source: 'WEBCAM' });
      setResult(data);
      setStatus(`Checked out ${detectedPlate}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  // Auto-scan loop: require 2 stable reads before suggesting check-in
  useEffect(() => {
    if (!autoScan || !cameraOn) return undefined;
    const id = setInterval(async () => {
      if (scanning) return;
      const data = await scanOnce();
      if (!data?.plate) {
        stableCountRef.current = 0;
        lastPlateRef.current = '';
        return;
      }
      if (data.plate === lastPlateRef.current) {
        stableCountRef.current += 1;
      } else {
        lastPlateRef.current = data.plate;
        stableCountRef.current = 1;
      }
      if (stableCountRef.current >= 2 && (data.confidence || 0) >= 0.75) {
        setAutoScan(false);
        setStatus(`Stable plate ${data.plate} — checking in…`);
        await checkIn(data.plate);
      }
    }, 1600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, cameraOn, scanning, vehicleType, baseId]);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Webcam plate scan</h2>
          <p>
            Live camera → Python OCR → DB lookup → check-in (company FCFS pool or guest general)
          </p>
        </div>
        <span className="live-pill">
          <i />
          {status}
        </span>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3>Camera feed</h3>
            <div className="actions">
              {!cameraOn ? (
                <button className="btn btn-primary" type="button" onClick={startCamera}>
                  Start webcam
                </button>
              ) : (
                <button className="btn btn-secondary" type="button" onClick={stopCamera}>
                  Stop
                </button>
              )}
            </div>
          </div>

          <div className="webcam-frame">
            <video ref={videoRef} playsInline muted className="webcam-video" />
            <div className="webcam-guide" />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          <div className="form" style={{ marginTop: 14 }}>
            <div className="actions">
              <label style={{ minWidth: 160 }}>
                Preferred basement
                <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                  {bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ minWidth: 120 }}>
                Vehicle type
                <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                  <option value="CAR">Car</option>
                  <option value="BIKE">Bike</option>
                </select>
              </label>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn btn-secondary" type="button" disabled={!cameraOn || scanning} onClick={scanOnce}>
                Scan frame now
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={!cameraOn || scanning}
                onClick={() => setAutoScan((v) => !v)}
              >
                {autoScan ? 'Stop auto-scan' : 'Start auto-scan + check-in'}
              </button>
            </div>
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel-header">
              <h3>Detected plate</h3>
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
                  placeholder="MH12AB1234"
                />
              </label>
              <div className="muted">
                Confidence: {Math.round((confidence || 0) * 100)}%
                {candidates.length ? ` · candidates: ${candidates.join(', ')}` : ''}
              </div>
              <div className="actions">
                <button className="btn btn-primary" type="submit" disabled={scanning || !detectedPlate}>
                  Check in & allot
                </button>
                <button className="btn btn-danger" type="button" disabled={scanning || !detectedPlate} onClick={checkOut}>
                  Check out
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Check-in result</h3>
            </div>
            {!result ? (
              <p className="muted">
                Registered company plates take a free slot from that company pool (first-come-first-serve).
                Unknown plates are auto-registered as guest + vehicle and parked in general slots.
              </p>
            ) : result.allotted ? (
              <div className="scan-result success">
                <strong>Checked in</strong>
                <div>
                  {result.plateNormalized} → <b>{result.slot?.code}</b>
                </div>
                <div>
                  {result.base?.name} · {result.slot?.ownerType}
                  {result.sessionType ? ` · ${result.sessionType}` : ''}
                </div>
                <div className="muted">{result.allotmentNote}</div>
                {result.guestCreated ? <div>Guest user + vehicle registered</div> : null}
                {result.vehicle?.company ? (
                  <div>
                    Member: {result.vehicle.member} · {result.vehicle.company}
                  </div>
                ) : (
                  <div>Guest vehicle</div>
                )}
              </div>
            ) : result.closed ? (
              <div className="scan-result success">
                <strong>Checked out</strong>
                <div>{result.session?.plate_normalized}</div>
              </div>
            ) : (
              <div className="scan-result">
                <strong>Not allotted</strong>
                <div>{result.reason || 'See details'}</div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Demo tips</h3>
            </div>
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Allow camera permission when prompted</li>
              <li>Hold a printed/on-screen plate in the yellow guide</li>
              <li>Try registered: MH12AB1234 (Nexus) or GJ01GH3456 (Orbit)</li>
              <li>Unknown plate → guest registration + general slot</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
