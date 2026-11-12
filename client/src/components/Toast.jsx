import { useEffect, useRef } from 'react';

/** One short confirmation at a time, with an optional Undo. Announced to screen readers. */
export default function Toast({ toast, onClose }) {
  // The parent re-renders on every poll; keep the latest onClose without restarting the timer.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => closeRef.current(), toast.undo ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.undo();
                onClose();
              }}
            >
              Undo
            </button>
          )}
          <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}
