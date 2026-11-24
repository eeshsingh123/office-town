import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { saveOnboarding } from "../onboarding/onboarding.ts";
import { ReleaseList } from "./Releases.tsx";
import { LATEST, unseen } from "./whats-new.ts";

// Once after an update, with what changed since the user last looked. The close button sits in
// the head, so a long list never has to be scrolled to the end to leave.
export function WhatsNewDialog() {
  const seen = useApp((state) => state.onboarding?.whatsNewSeen);
  const releases = unseen(seen);
  if (releases.length === 0) return null;
  const close = () => void saveOnboarding({ whatsNewSeen: LATEST });
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content
          className={`${dialog.content} ${dialog.fixed}`}
          aria-describedby={undefined}
        >
          <div className={dialog.head}>
            <Dialog.Title className={dialog.title}>What's new</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" icon aria-label="Close">
                <X size={16} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <div className={dialog.body}>
            <ReleaseList releases={releases} latest={LATEST} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
