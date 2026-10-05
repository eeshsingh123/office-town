import type { Autonomy } from "@office-town/contract";
import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { AUTONOMY } from "./autonomy.ts";
import { Button } from "./Button.tsx";
import dialog from "./Dialog.module.css";

interface BypassDialogProps {
  open: boolean;
  // Who would run unguarded, such as "Web team" or "this agent".
  who: string;
  // The level kept if the user backs out.
  keepLabel: string;
  onBypass: () => void;
  onFull: () => void;
  onKeep: () => void;
}

// Bypass turns off every guard, so it takes a deliberate yes; Full is offered instead, since it
// still records every action (D-40).
export function BypassDialog({
  open,
  who,
  keepLabel,
  onBypass,
  onFull,
  onKeep,
}: BypassDialogProps) {
  const [understood, setUnderstood] = useState(false);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
        setUnderstood(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialog.overlay} />
        <AlertDialog.Content className={dialog.content}>
          <AlertDialog.Title className={dialog.title}>
            Turn off every guard for {who}?
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className={dialog.description}>
              <p>
                With Bypass, the agents run in their harness's bypass mode. They will not ask before
                they:
              </p>
              <ul>
                <li>run any command on this computer</li>
                <li>change or delete files in any folder, not only the workspace</li>
                <li>use the web, push code or open pull requests</li>
              </ul>
              <p>
                Office Town cannot see these actions before they happen, so nothing is held for you
                in Needs you. Full also lets agents do everything, but every action passes through
                Office Town, so it is recorded and you can lower the level at any time.
              </p>
            </div>
          </AlertDialog.Description>
          <label className={dialog.check}>
            <input
              type="checkbox"
              checked={understood}
              onChange={(change) => setUnderstood(change.target.checked)}
            />
            I understand that nothing will be guarded or asked
          </label>
          <div className={dialog.actions}>
            <Button onClick={onFull}>Use Full instead</Button>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Keep {keepLabel}</Button>
            </AlertDialog.Cancel>
            <Button variant="primary" disabled={!understood} onClick={onBypass}>
              Turn on Bypass
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// Choosing Bypass asks first; every other level is chosen at once.
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
      keepLabel={AUTONOMY[level].label}
      onBypass={() => settle("bypass")}
      onFull={() => settle("full")}
      onKeep={() => setAsking(false)}
    />
  );
  return { choose, confirm };
}
