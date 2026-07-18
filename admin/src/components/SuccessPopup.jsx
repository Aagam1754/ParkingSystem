export default function SuccessPopup({ open, title, lines = [], tone = 'success', onClose }) {
  if (!open) return null;
  return (
    <div className="popup-backdrop" role="dialog" aria-modal="true">
      <div className={`popup-card ${tone}`}>
        <div className="popup-glow" />
        <h3>{title}</h3>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <button className="btn btn-primary" type="button" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
