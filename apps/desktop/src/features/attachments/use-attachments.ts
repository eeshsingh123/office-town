import {
  type Attachment,
  type AttachmentKind,
  type LibraryItem,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
} from "@office-town/contract";
import { type ClipboardEvent, type DragEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { isImage } from "./kinds.ts";

// A file or folder the user picked; the core keeps it once `attachment` is set.
export interface Picked {
  key: string;
  name: string;
  kind: AttachmentKind;
  bytes?: number;
  attachment?: Attachment;
  error?: string;
  fromLibrary?: true;
}

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

function pastedName(): string {
  const time = new Date().toTimeString().slice(0, 8).replaceAll(":", "-");
  return `Pasted image ${time}.png`;
}

// Each file is sent to the core as soon as it is picked, so Send waits only for what is left.
export function useAttachments() {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = (key: string, change: Partial<Picked>) =>
    setPicked((list) => list.map((one) => (one.key === key ? { ...one, ...change } : one)));
  // One with an error is shown, never stored.
  const add = (one: Picked, store?: () => Promise<Attachment>) => {
    setPicked((list) => {
      if (list.length < MAX_ATTACHMENTS) return [...list, one];
      return [...list, { ...one, error: `At most ${MAX_ATTACHMENTS} files per message` }];
    });
    if (one.error !== undefined || store === undefined) return;
    store()
      .then((attachment) => update(one.key, { attachment }))
      .catch((failure: unknown) => update(one.key, { error: errorText(failure) }));
  };

  const addFiles = (files: readonly File[]) => {
    for (const file of files) {
      const name = file.name === "" || file.name === "image.png" ? pastedName() : file.name;
      const one: Picked = {
        key: crypto.randomUUID(),
        name,
        kind: isImage(name) ? "image" : "file",
        bytes: file.size,
        ...(file.size > MAX_ATTACHMENT_BYTES ? { error: "Larger than 20 MB" } : {}),
      };
      add(one, () => api.uploadFile(file, name));
    }
  };

  const addFolder = (path: string) => {
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    add({ key: crypto.randomUUID(), name, kind: "folder" }, () => api.linkFolder(path));
  };

  // Already kept by the core, so it is ready at once; picking it twice adds it once.
  const addFromLibrary = ({ file }: LibraryItem) => {
    if (picked.some((one) => one.attachment?.id === file.id)) return;
    add({
      key: crypto.randomUUID(),
      name: file.name,
      kind: file.kind,
      ...(file.bytes === undefined ? {} : { bytes: file.bytes }),
      attachment: file,
      fromLibrary: true,
    });
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  const dropHandlers = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(false);
      const files: File[] = [];
      for (const item of event.dataTransfer.items) {
        const file = item.getAsFile();
        if (file === null) continue;
        if (!item.webkitGetAsEntry()?.isDirectory) files.push(file);
        else if (shell === undefined) {
          const error = "Folders can be dropped in the app only";
          add({ key: crypto.randomUUID(), name: file.name, kind: "folder", error });
        } else addFolder(shell.pathOf(file));
      }
      addFiles(files);
    },
  };

  return {
    picked,
    ids: picked.flatMap((one) =>
      one.attachment === undefined || one.error !== undefined ? [] : [one.attachment.id],
    ),
    // Send waits for these; a failed one is left out.
    adding: picked.some((one) => one.attachment === undefined && one.error === undefined),
    dragging,
    addFiles,
    addFolder,
    addFromLibrary,
    remove: (key: string) => setPicked((list) => list.filter((one) => one.key !== key)),
    clear: () => setPicked([]),
    onPaste,
    dropHandlers,
  };
}

export type Attachments = ReturnType<typeof useAttachments>;
