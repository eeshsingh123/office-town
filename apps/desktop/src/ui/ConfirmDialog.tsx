import { AlertDialog } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button } from "./Button.tsx";
import dialog from "./Dialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  // Closes the dialog once it resolves; a failure is shown in it.
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  };
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        setError(undefined);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialog.overlay} />
        <AlertDialog.Content className={dialog.content}>
          <AlertDialog.Title className={dialog.title}>{title}</AlertDialog.Title>
          <AlertDialog.Description className={dialog.description}>
            {description}
          </AlertDialog.Description>
          {children}
          {error === undefined ? null : (
            <p className={dialog.error} role="alert">
              {error}
            </p>
          )}
          <div className={dialog.actions}>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <Button variant="primary" onClick={confirm} disabled={busy}>
              {busy ? `${confirmLabel}…` : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
