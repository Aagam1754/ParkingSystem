import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Auto-dismiss success overlay (no OK button).
 * Uses a portal + stable timer so parent re-renders don't kill the popup.
 */
export default function SuccessPopup({
  open,
  title,
  lines = [],
  tone = 'success',
  autoCloseMs = 1000,
  showOk = false,
  onClose,
}) {
  const onCloseRef = useRef(onClose);
  const shownAtRef = useRef(0);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || showOk) return undefined;
    shownAtRef.current = Date.now();
    const id = setTimeout(() => {
      onCloseRef.current?.();
    }, autoCloseMs);
    return () => clearTimeout(id);
    // Only restart timer when open / duration changes — NOT when onClose identity changes
  }, [open, autoCloseMs, showOk]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="popup-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={() => onCloseRef.current?.()}
    >
      <div className={`popup-card ${tone}`} onClick={(e) => e.stopPropagation()}>
        <div className="popup-glow" />
        <h3>{title}</h3>
        {lines.filter(Boolean).map((line, idx) => (
          <p key={`${idx}-${line}`}>{line}</p>
        ))}
        {showOk ? (
          <button className="btn btn-primary" type="button" onClick={() => onCloseRef.current?.()}>
            OK
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
