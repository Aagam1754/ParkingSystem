import { useEffect } from 'react';

/**
 * Auto-dismiss success overlay. No OK button by default.
 */
export default function SuccessPopup({
  open,
  title,
  lines = [],
  tone = 'success',
  autoCloseMs = 3500,
  showOk = false,
  onClose,
}) {
  useEffect(() => {
    if (!open || !onClose || showOk) return undefined;
    const id = setTimeout(() => onClose(), autoCloseMs);
    return () => clearTimeout(id);
  }, [open, autoCloseMs, showOk, onClose]);

  if (!open) return null;

  return (
    <div
      className="popup-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={() => onClose?.()}
    >
      <div
        className={`popup-card ${tone}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup-glow" />
        <h3>{title}</h3>
        {lines.filter(Boolean).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {showOk ? (
          <button className="btn btn-primary" type="button" onClick={onClose}>
            OK
          </button>
        ) : (
          <p className="popup-auto-hint">Closing automatically…</p>
        )}
      </div>
    </div>
  );
}
