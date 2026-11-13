import type { Autonomy } from "@office-town/contract";
import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { Button } from "./Button.tsx";
import dialog from "./Dialog.module.css";

interface BypassDialogProps {
  open: boolean;
  // Such as "Web team" or "this agent".
  who: string;
  onBypass: () => void;
  onFull: () => void;
  onKeep: () => void;
}

// Full is offered instead, since it still records every action (D-40).
export function BypassDialog({ open, who, onBypass, onFull, onKeep }: BypassDialogProps) {
  const [understood, setUnderstood] = useState(false);
  // Every way out clears the box, so the next warning is read afresh.
  const settle = (then: () => void) => () => {
    setUnderstood(false);
    then();
  };
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(onKeep)();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialog.overlay} />
        <AlertDialog.Content className={dialog.content}>
          <AlertDialog.Title className={dialog.title}>
            Turn off all safety checks for {who}?
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className={dialog.description}>
              <p>Agents won't ask before they:</p>
              <ul>
                <li>run any command</li>
                <li>change or delete files in any folder</li>
                <li>use the web, push code or open pull requests</li>
              </ul>
              <p>
                Office Town can't see these actions first, so you won't be asked. "Auto" allows
                the same, but still records each action.
              </p>
            </div>
          </AlertDialog.Description>
          <label className={dialog.check}>
            <input
              type="checkbox"
              checked={understood}
              onChange={(change) => setUnderstood(change.target.checked)}
            />
            I understand nothing will be checked
          </label>
          <div className={dialog.actions}>
            <Button onClick={settle(onFull)}>Use "Auto" instead</Button>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <Button variant="primary" disabled={!understood} onClick={settle(onBypass)}>
              Turn off safety checks
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// Only Bypass asks first.
export function useBypassGate(level: Autonomy, setLevel: (level: Autonomy) => void, who: string) {
  const [asking, setAsking] = useState(false);
  const settle = (next: Autonomy) => {
    setAsking(false);
    setLevel(next);
  };
  const choose = (next: Autonomy) => {
    if (next === "bypass" && level !== "bypass") setAsking(true);
    else setLevel(next);
  };
  const confirm = (
    <BypassDialog
      open={asking}
      who={who}
      onBypass={() => settle("bypass")}
      onFull={() => settle("full")}
      onKeep={() => setAsking(false)}
    />
  );
  return { choose, confirm };
}
