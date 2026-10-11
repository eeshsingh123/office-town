import type { LibraryItem } from "@office-town/contract";
import { Plus, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import menu from "../../ui/Menu.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { typeLabel } from "../attachments/kinds.ts";
import styles from "./Library.module.css";
import {
  audienceNames,
  givenDirectly,
  givenToSomeone,
  type Holder,
  reaches,
  useLibrary,
  withHolder,
} from "./library.ts";

async function give(item: LibraryItem, holder: Holder, on: boolean): Promise<void> {
  try {
    await api.changeLibraryItem(item.id, { givenTo: withHolder(item.givenTo, holder, on) });
  } catch (failure) {
    showToast(failure instanceof Error ? failure.message : String(failure));
  }
}

// What a department or one agent gets in every task, from its workspace's Library.
export function FilesSection({
  workspaceId,
  holder,
  name,
}: {
  workspaceId: string;
  holder: Holder;
  name: string;
}) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const items = useLibrary(workspaceId);
  const given = items.filter((item) => reaches(item, holder));
  const others = items.filter((item) => !reaches(item, holder));
  const openLibrary = () => navigate({ name: "workspace", workspaceId, tab: "library" });

  return (
    <div className={styles.files}>
      <div className={styles.filesHead}>
        <span className={form.label}>Files</span>
        <span className={form.row}>
          <Button variant="ghost" onClick={openLibrary}>
            Open Library
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button disabled={others.length === 0}>
                <Plus size={14} aria-hidden />
                Add from Library
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className={`${menu.surface} ${styles.menu}`}
                align="end"
                sideOffset={4}
              >
                {others.map((item) => (
                  <DropdownMenu.Item
                    key={item.id}
                    className={menu.item}
                    onSelect={() => void give(item, holder, true)}
                  >
                    <span className={styles.tile} aria-hidden>
                      {typeLabel(item.file.name, item.file.kind)}
                    </span>
                    <span className={menu.itemText}>
                      {item.file.name}
                      <span className={menu.itemDescription}>
                        Now: {audienceNames(item.givenTo, departments, agents)}
                      </span>
                    </span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
      </div>
      {given.length === 0 ? (
        <p className={form.hint}>
          {items.length === 0 ? "The Library is empty." : `Nothing given to ${name} yet.`}
        </p>
      ) : (
        <ul className={styles.fileList} aria-label={`Files ${name} gets`}>
          {given.map((item) => {
            const direct = givenDirectly(item, holder);
            const last = direct && !givenToSomeone(withHolder(item.givenTo, holder, false));
            return (
              <li key={item.id} className={styles.fileRow}>
                <span className={styles.tile} aria-hidden>
                  {typeLabel(item.file.name, item.file.kind)}
                </span>
                <span className={styles.nameText}>
                  <b title={item.file.path}>{item.file.name}</b>
                </span>
                <span className={styles.from}>
                  {direct
                    ? "Given here"
                    : item.givenTo.everyone
                      ? "Everyone"
                      : `From ${departments[holder.departmentId]?.name ?? "the team"}`}
                </span>
                {direct ? (
                  <Button
                    icon
                    variant="ghost"
                    disabled={last}
                    title={last ? "Given only here. Remove it in the Library." : undefined}
                    aria-label={`Stop giving ${item.file.name} to ${name}`}
                    onClick={() => void give(item, holder, false)}
                  >
                    <X size={14} aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
