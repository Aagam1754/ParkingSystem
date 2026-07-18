import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Stable webcam helper — avoids play() interrupted by new load (StrictMode / remount).
 */
export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const startingRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const stopCamera = useCallback(() => {
    startingRef.current = false;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks()?.forEach((t) => t.stop());
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
    }
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setCameraError('');

    // Stop any previous stream before requesting a new one
    streamRef.current?.getTracks()?.forEach((t) => t.stop());
    streamRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      // If unmounted / stopped while waiting for permission
      if (!startingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        startingRef.current = false;
        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = () => resolve();
      });

      try {
        await video.play();
      } catch (err) {
        // Benign race when React remounts or a newer load starts
        if (err?.name === 'AbortError' || /interrupted/i.test(err?.message || '')) {
          // retry once after a tick
          await new Promise((r) => setTimeout(r, 120));
          if (video.srcObject === stream) {
            await video.play().catch(() => {});
          }
        } else {
          throw err;
        }
      }

      if (startingRef.current) setCameraOn(true);
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        setCameraError('Camera permission denied. Allow webcam access in the browser.');
      } else if (err?.name === 'AbortError' || /interrupted/i.test(err?.message || '')) {
        // Ignore transient play race — user can press Start cam
        setCameraError('');
      } else {
        setCameraError(`Camera error: ${err.message}`);
      }
      setCameraOn(false);
    } finally {
      startingRef.current = false;
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return { videoRef, cameraOn, cameraError, startCamera, stopCamera, setCameraError };
}
