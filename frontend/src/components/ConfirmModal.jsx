import './ConfirmModal.css';

export default function ConfirmModal({ open, title, message, onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <h2>{title}</h2>

        <p>{message}</p>

        <div className="modalActions">
          <button className="modalCancel" onClick={onCancel}>
            Cancelar
          </button>

          <button className="modalConfirm" onClick={onConfirm}>
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
