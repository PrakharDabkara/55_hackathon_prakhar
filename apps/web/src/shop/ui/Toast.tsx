import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const SHOW_MS = 4000;
const ToastContext = createContext<((message: string) => void) | null>(null);

/** One message at a time, announced politely, gone after four seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((next: string) => {
    setMessage(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), SHOW_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="sh-toast-region" role="status" aria-live="polite">
        {message && <p className="sh-toast">{message}</p>}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
