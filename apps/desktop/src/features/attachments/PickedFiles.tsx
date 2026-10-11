import type { LibraryItem } from "@office-town/contract";
import { BookOpen, FolderOpen, ImageIcon, Paperclip, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef } from "react";
import { shell } from "../../shell.ts";
import menu from "../../ui/Menu.module.css";
import styles from "./Attachments.module.css";
import { isOffice, sizeText, typeLabel } from "./kinds.ts";
import type { Attachments, Picked } from "./use-attachments.ts";

function noteOf(one: Picked, seesImages: boolean | undefined): { text: string; warn: boolean } {
  if (one.error !== undefined) return { text: one.error, warn: true };
  if (one.attachment === undefined) return { text: "Adding…", warn: false };
  if (one.kind === "folder") {
    return {
      text: one.fromLibrary ? "Folder · from the Library" : "Folder · read-only",
      warn: false,
    };
  }
  const size = one.bytes === undefined ? "" : sizeText(one.bytes);
  if (one.kind === "image" && seesImages === false) {
    return { text: "This model cannot see images · it gets the path", warn: true };
  }
  if (isOffice(one.name)) return { text: `${size} · may not be readable`, warn: true };
  const kind = one.kind === "image" ? "Image" : "File";
  return { text: `${kind} · ${size}${one.fromLibrary ? " · from the Library" : ""}`, warn: false };
}

// The files picked for the next message, each removable, with what the agent will get.
export function PickedFiles({
  files,
  seesImages,
  className,
}: {
  files: Attachments;
  seesImages: boolean | undefined;
  className?: string | undefined;
}) {
  if (files.picked.length === 0) return null;
  return (
    <ul className={`${styles.chips} ${className ?? ""}`} aria-label="Files to send">
      {files.picked.map((one) => {
        const note = noteOf(one, seesImages);
        return (
          <li key={one.key} className={`${styles.chip} ${note.warn ? styles.warn : ""}`}>
            <span className={styles.tile} aria-hidden>
              {typeLabel(one.name, one.kind)}
            </span>
            <span className={styles.chipText}>
              <b title={one.name}>{one.name}</b>
              <span>{note.text}</span>
            </span>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove ${one.name}`}
              onClick={() => files.remove(one.key)}
            >
              <X size={12} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Files and images from a picker; a folder needs the app, which can name its path. Library items
// are offered when the message has a workspace to take them from.
export function AttachButton({
  files,
  library = [],
  className,
}: {
  files: Attachments;
  library?: readonly LibraryItem[];
  className?: string | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pickFolder = async () => {
    const path = await shell?.pickFolder();
    if (path) files.addFolder(path);
  };
  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        files.addFiles([...(event.target.files ?? [])]);
        event.target.value = "";
      }}
    />
  );
  if (shell === undefined && library.length === 0) {
    return (
      <>
        {picker}
        <button
          type="button"
          className={className}
          aria-label="Attach files"
          title="Attach files"
          onClick={() => input.current?.click()}
        >
          <Paperclip size={15} aria-hidden />
        </button>
      </>
    );
  }
  return (
    <>
      {picker}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={className} aria-label="Attach" title="Attach">
          <Paperclip size={15} aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={menu.surface} align="start" sideOffset={6}>
            <DropdownMenu.Item className={menu.item} onSelect={() => input.current?.click()}>
              <ImageIcon size={14} aria-hidden />
              <span className={menu.itemText}>Files and images</span>
            </DropdownMenu.Item>
            {shell === undefined ? null : (
              <DropdownMenu.Item className={menu.item} onSelect={() => void pickFolder()}>
                <FolderOpen size={14} aria-hidden />
                <span className={menu.itemText}>
                  Folder
                  <span className={menu.itemDescription}>Linked read-only</span>
                </span>
              </DropdownMenu.Item>
            )}
            {library.length === 0 ? null : (
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className={menu.item}>
                  <BookOpen size={14} aria-hidden />
                  <span className={menu.itemText}>
                    From the Library
                    <span className={menu.itemDescription}>Or type # in the message</span>
                  </span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    className={`${menu.surface} ${styles.libraryMenu}`}
                    sideOffset={6}
                  >
                    {library.map((item) => (
                      <DropdownMenu.Item
                        key={item.id}
                        className={menu.item}
                        onSelect={() => files.addFromLibrary(item)}
                      >
                        <span className={styles.tile} aria-hidden>
                          {typeLabel(item.file.name, item.file.kind)}
                        </span>
                        <span className={menu.itemText}>{item.file.name}</span>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
