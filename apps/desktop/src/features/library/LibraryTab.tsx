import type { AttachmentKind, LibraryAudience, LibraryItem } from "@office-town/contract";
import { Check, ChevronDown, FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type DragEvent, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { useApp } from "../../store/app-store.ts";
import { ContextMenu, type MenuContent, MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { ago } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { fileMenu } from "../attachments/file-menu.ts";
import { sizeText, typeLabel } from "../attachments/kinds.ts";
import { GivenToMenu, useHolders } from "./GivenToMenu.tsx";
import styles from "./Library.module.css";
import { addFiles, addFolder, EVERYONE, replaceFile, usedText, useLibrary } from "./library.ts";

type Kind = AttachmentKind | "all";
// "" shows all, "everyone" the items given to everyone, else a department's id.
type Audience = string;

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "file", label: "Files" },
  { value: "image", label: "Images" },
  { value: "folder", label: "Folders" },
];

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

// One list for a Library item's "…" and right-click menus (D-89): the file's own actions, then
// Replace and Remove.
function itemMenu(item: LibraryItem, replace: () => void): MenuContent {
  const { file } = item;
  const own = fileMenu(file.path, file.kind).actions;
  return {
    actions: [
      ...own,
      ...(file.kind === "folder"
        ? []
        : [{ label: "Replace with a new version", icon: RefreshCw, run: replace }]),
      {
        label: "Remove from Library",
        icon: Trash2,
        danger: true,
        run: async () => {
          await api.removeLibraryItem(item.id);
          showToast(`Removed ${file.name}`);
        },
      },
    ],
  };
}

function Row({ item }: { item: LibraryItem }) {
  const input = useRef<HTMLInputElement>(null);
  const adder = useApp((state) =>
    item.addedByAgentId === undefined ? undefined : state.agents[item.addedByAgentId],
  );
  const { file } = item;
  const meta = [
    file.kind === "folder" ? "Linked folder" : sizeText(file.bytes ?? 0),
    adder === undefined
      ? `Added ${ago(item.createdAt)}`
      : `Added by ${adder.name} ${ago(item.createdAt)}`,
  ];
  const menuOf = () => itemMenu(item, () => input.current?.click());
  // Clicking the name opens it, where it can be opened safely.
  const open = fileMenu(file.path, file.kind).actions.find((action) => action.label === "Open");
  return (
    <ContextMenu menu={menuOf}>
      <li className={styles.row}>
        <input
          ref={input}
          type="file"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen === undefined) return;
            replaceFile(item.id, chosen)
              .then(() => showToast(`Replaced ${file.name}`))
              .catch((failure: unknown) => showToast(errorText(failure)));
          }}
        />
        <span className={styles.nameCell}>
          <span className={styles.tile} aria-hidden>
            {typeLabel(file.name, file.kind)}
          </span>
          <span className={styles.nameText}>
            {open?.run === undefined ? (
              <b title={file.path}>{file.name}</b>
            ) : (
              <button
                type="button"
                className={styles.nameButton}
                title={file.path}
                onClick={() => void open.run?.()}
              >
                {file.name}
              </button>
            )}
            <span>{meta.join(" · ")}</span>
          </span>
        </span>
        <GivenToMenu item={item} />
        <span className={styles.used}>{usedText(item)}</span>
        <MoreMenu label={`More for ${file.name}`} menu={menuOf} />
      </li>
    </ContextMenu>
  );
}

// A workspace's reference files and folders, each given to everyone or to some of its teams.
export function LibraryTab({ workspaceId }: { workspaceId: string }) {
  const items = useLibrary(workspaceId);
  const holders = useHolders(workspaceId);
  const departments = useApp((state) => state.departments);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [audience, setAudience] = useState<Audience>("");
  const [adding, setAdding] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const words = query.trim().toLowerCase();
  const memberIds = new Set(
    holders.find(({ department }) => department.id === audience)?.members.map(({ id }) => id),
  );
  const shown = items.filter(({ file, givenTo }) => {
    if (words !== "" && !file.name.toLowerCase().includes(words)) return false;
    if (kind !== "all" && file.kind !== kind) return false;
    if (audience === "everyone") return givenTo.everyone;
    if (audience === "") return true;
    return (
      givenTo.departmentIds.includes(audience) || givenTo.agentIds.some((id) => memberIds.has(id))
    );
  });
  // Added while a department is shown, an item goes to that department.
  const givenTo: LibraryAudience =
    audience === "" || audience === "everyone"
      ? EVERYONE
      : { everyone: false, departmentIds: [audience], agentIds: [] };
  const audienceLabel =
    audience === ""
      ? "All"
      : audience === "everyone"
        ? "Everyone"
        : (departments[audience]?.name ?? "");

  const track = async (count: number, work: () => Promise<string[]>) => {
    setAdding((now) => now + count);
    try {
      const failed = await work();
      setErrors((now) => [...now, ...failed]);
    } finally {
      setAdding((now) => now - count);
    }
  };
  const add = (files: File[]) => {
    if (files.length > 0) void track(files.length, () => addFiles(workspaceId, files, givenTo));
  };
  const link = (path: string) =>
    track(1, () =>
      addFolder(workspaceId, path, givenTo).then(
        () => [],
        (failure: unknown) => [`Could not add ${path}: ${errorText(failure)}`],
      ),
    );
  const pickFolder = async () => {
    const path = await shell?.pickFolder();
    if (path) await link(path);
  };
  const drop = {
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
      for (const entry of event.dataTransfer.items) {
        const file = entry.getAsFile();
        if (file === null) continue;
        if (!entry.webkitGetAsEntry()?.isDirectory) files.push(file);
        else if (shell === undefined) {
          setErrors((now) => [...now, `Folders can be added in the app only: ${file.name}`]);
        } else void link(shell.pathOf(file));
      }
      add(files);
    },
  };

  const counts = (value: Kind) =>
    value === "all" ? items.length : items.filter((item) => item.file.kind === value).length;
  // Filters show only once they have something to narrow (a5-31).
  const kinds = new Set(items.map((item) => item.file.kind)).size;

  return (
    <section
      className={`${styles.tab} ${dragging ? styles.dropping : ""}`}
      aria-label="Library"
      {...drop}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          add([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <div className={styles.tools}>
        {items.length >= 8 || query !== "" ? (
          <SearchBox
            value={query}
            onChange={(value) => setQuery(value)}
            label="Search the Library"
          />
        ) : null}
        {items.length === 0 ? null : (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className={`${menu.chip} ${styles.filter}`}>
              <span className={menu.chipLabel}>Given to</span>
              {audienceLabel}
              <ChevronDown size={13} aria-hidden />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
                <DropdownMenu.RadioGroup value={audience} onValueChange={setAudience}>
                  {[
                    { value: "", label: "All" },
                    { value: "everyone", label: "Everyone" },
                    ...holders.map(({ department }) => ({
                      value: department.id,
                      label: department.name,
                    })),
                  ].map((choice) => (
                    <DropdownMenu.RadioItem
                      key={choice.value}
                      value={choice.value}
                      className={menu.item}
                    >
                      <span className={menu.itemText}>{choice.label}</span>
                      <DropdownMenu.ItemIndicator>
                        <Check size={14} className={menu.check} aria-hidden />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
        {kinds < 2 && kind === "all" ? null : (
          <fieldset className={`${form.row} ${form.group}`}>
            <legend className="visually-hidden">Type</legend>
            {KINDS.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={form.chip}
                aria-pressed={kind === choice.value}
                onClick={() => setKind(choice.value)}
              >
                {choice.label} {counts(choice.value)}
              </button>
            ))}
          </fieldset>
        )}
        <span className={styles.add} data-tour="library-add">
          {shell === undefined ? null : (
            <Button onClick={() => void pickFolder()}>
              <FolderOpen size={14} aria-hidden />
              Add folder
            </Button>
          )}
          <Button variant="primary" onClick={() => input.current?.click()}>
            <Plus size={14} aria-hidden />
            Add files
          </Button>
        </span>
      </div>

      {adding > 0 ? (
        <p className={form.hint} role="status">
          Adding {adding} {adding === 1 ? "item" : "items"}
        </p>
      ) : null}
      {errors.length === 0 ? null : (
        <div className={styles.errors} role="alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => setErrors([])}>
            Dismiss
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <div className={styles.empty}>
          <strong>No files yet</strong>
          <p className={form.hint}>
            Drop files or folders here. Agents get them as reference in every task.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.empty}>
          <strong>Nothing matches</strong>
          <p className={form.hint}>Try a different word, or show all.</p>
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.head} aria-hidden>
            <span>Name</span>
            <span>Given to</span>
            <span>Used</span>
            <span />
          </div>
          <ul className={styles.rows} aria-label="Library items">
            {shown.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
