import { useEffect } from "react";
import { create } from "zustand";
import styles from "./Toast.module.css";

interface Toast {
  text: string;
  action?: { label: string; run: () => void };
  // A repeat of the same text still shows again.
  at: number;
}

const SHOWN_FOR_MS = 6000;

const useToast = create<{ toast: Toast | undefined }>(() => ({ toast: undefined }));

// A short message that confirms something was saved, with at most one follow-up link.
export function showToast(text: string, action?: Toast["action"]): void {
  useToast.setState({
    toast: { text, ...(action === undefined ? {} : { action }), at: Date.now() },
  });
}

export function Toaster() {
  const toast = useToast((state) => state.toast);
  useEffect(() => {
    if (toast === undefined) return;
    const timer = setTimeout(() => useToast.setState({ toast: undefined }), SHOWN_FOR_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  if (toast === undefined) return null;
  return (
    <div className={styles.toast} role="status">
      <span>{toast.text}</span>
      {toast.action === undefined ? null : (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.run();
            useToast.setState({ toast: undefined });
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
