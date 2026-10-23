import { Dialog } from "radix-ui";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { saveOnboarding } from "../onboarding/onboarding.ts";
import { ReleaseList } from "./Releases.tsx";
import { LATEST, unseen } from "./whats-new.ts";

// Once after an update, with what changed since the user last looked.
export function WhatsNewDialog() {
  const seen = useApp((state) => state.onboarding?.whatsNewSeen);
  const releases = unseen(seen);
  if (releases.length === 0) return null;
  const close = () => void saveOnboarding({ whatsNewSeen: LATEST });
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={dialog.content} aria-describedby={undefined}>
          <Dialog.Title className={dialog.title}>What's new</Dialog.Title>
          <ReleaseList releases={releases} latest={LATEST} />
          <div className={dialog.actions}>
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
