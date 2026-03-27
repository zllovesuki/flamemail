import { useCallback, useEffect, useState } from "react";
import { CheckCircle, AlertTriangle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let nextId = 0;
let addToastFn: ((type: ToastType, message: string) => void) | null = null;

export function toast(type: ToastType, message: string) {
  addToastFn?.(type, message);
}

toast.success = (message: string) => toast("success", message);
toast.error = (message: string) => toast("error", message);
toast.info = (message: string) => toast("info", message);

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
};

const styles: Record<ToastType, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
  info: "border-accent-500/30 bg-accent-500/10 text-accent-300",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => {
      addToastFn = null;
    };
  }, [addToast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-[100] flex flex-col items-end gap-2 sm:left-auto"
    >
      {toasts.map((item) => (
        <ToastNotification key={item.id} item={item} onDismiss={removeToast} />
      ))}
    </div>
  );
}

function ToastNotification({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = icons[item.type];

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), 4000);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);

  return (
    <div
      className={`animate-slide-up flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${styles[item.type]}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium">{item.message}</span>
      <button
        type="button"
        className="ml-2 shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
        onClick={() => onDismiss(item.id)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
