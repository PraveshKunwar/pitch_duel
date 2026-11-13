type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "No",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="panel modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-desc" className="muted" style={{ marginTop: 10 }}>
          {message}
        </p>
        <div className="lobby-actions" style={{ marginTop: 24 }}>
          <button type="button" className="btn" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="btn secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
