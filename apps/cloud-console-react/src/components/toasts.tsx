import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
}

let counter = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string) => {
    const id = ++counter;
    setToasts((current) => [...current.slice(-2), { id, text }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 2600);
  }, []);
  return { toasts, push };
}

export function Toasts({ toasts }: { toasts: readonly Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
