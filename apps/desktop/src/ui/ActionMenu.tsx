import { type LucideIcon, MoreHorizontal } from "lucide-react";
import { DropdownMenu, ContextMenu as RightClick } from "radix-ui";
import {
  type ComponentType,
  Fragment,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { Button } from "./Button.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import styles from "./Menu.module.css";
import { showToast } from "./Toast.tsx";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// One thing the user can do to an object. The same list draws its "…" menu and its right-click
// menu, so the two never drift apart (D-89).
export interface MenuAction {
  label: string;
  icon: LucideIcon;
  note?: string;
  disabled?: boolean;
  // Drawn in red, apart at the end.
  danger?: boolean;
  // A failure shows as a toast.
  run?: () => void | Promise<void>;
  // Opened once the menu closes, instead of `run`.
  dialog?: (props: DialogProps) => ReactNode;
}

export interface MenuContent {
  header?: ReactNode;
  actions: MenuAction[];
}

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

// For a Stop or Delete: a stray click must not end work.
export function confirmed(
  action: Omit<MenuAction, "run" | "dialog" | "danger">,
  ask: { title: string; description: string; confirmLabel: string; run: () => Promise<void> },
): MenuAction {
  return {
    ...action,
    danger: true,
    dialog: (props) => (
      <ConfirmDialog
        {...props}
        title={ask.title}
        description={ask.description}
        confirmLabel={ask.confirmLabel}
        danger
        onConfirm={ask.run}
      />
    ),
  };
}

export function copyText(text: string): void {
  navigator.clipboard.writeText(text).then(
    () => showToast("Copied"),
    (failure: unknown) => showToast(`Could not copy: ${errorText(failure)}`),
  );
}

export function MenuHeader({
  face,
  title,
  detail,
}: {
  face: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className={styles.header}>
      {face}
      <span className={styles.itemText}>
        <b>{title}</b>
        <span className={styles.itemDescription}>{detail}</span>
      </span>
    </div>
  );
}

interface Parts {
  Item: ComponentType<{
    className?: string | undefined;
    disabled?: boolean;
    onSelect?: (event: Event) => void;
    children?: ReactNode;
  }>;
  Separator: ComponentType<{ className?: string | undefined }>;
}

function Items({
  content,
  parts: { Item, Separator },
  icons,
  onDialog,
}: {
  content: MenuContent;
  parts: Parts;
  icons: boolean;
  onDialog: (action: MenuAction) => void;
}) {
  const { header, actions } = content;
  const select = (action: MenuAction) => {
    if (action.dialog !== undefined) return onDialog(action);
    Promise.resolve()
      .then(action.run)
      .catch((failure: unknown) => showToast(errorText(failure)));
  };
  return (
    <>
      {header === undefined ? null : (
        <>
          {header}
          <Separator className={styles.separator} />
        </>
      )}
      {actions.map((action, index) => {
        const Icon = action.icon;
        const apart = action.danger === true && index > 0 && actions[index - 1]?.danger !== true;
        return (
          <Fragment key={action.label}>
            {apart ? <Separator className={styles.separator} /> : null}
            <Item
              className={`${styles.item} ${action.danger ? styles.danger : ""}`}
              {...(action.disabled === undefined ? {} : { disabled: action.disabled })}
              onSelect={() => select(action)}
            >
              {icons ? <Icon size={14} className={styles.itemIcon} aria-hidden /> : null}
              <span className={styles.itemText}>
                {action.dialog === undefined ? action.label : `${action.label}…`}
                {action.note === undefined ? null : (
                  <span className={styles.itemDescription}>{action.note}</span>
                )}
              </span>
            </Item>
          </Fragment>
        );
      })}
    </>
  );
}

// The dialog an action opened outlives its menu.
function useActionDialog() {
  const [action, setAction] = useState<MenuAction>();
  const dialog = action?.dialog?.({
    open: true,
    onOpenChange: (open) => {
      if (!open) setAction(undefined);
    },
  });
  return { open: setAction, dialog };
}

// Built on the click, so a long list of rows costs nothing until then. With nothing to offer
// (the object is gone) no menu opens, rather than an empty one. The click says what was under
// the pointer, such as a link inside a message.
export function ContextMenu({
  menu,
  children,
}: {
  menu: (click: MouseEvent<HTMLElement>) => MenuContent | undefined;
  children: ReactElement;
}) {
  const { open, dialog } = useActionDialog();
  const [content, setContent] = useState<MenuContent>();
  return (
    <>
      <RightClick.Root
        onOpenChange={(next) => {
          if (!next) setContent(undefined);
        }}
      >
        <RightClick.Trigger
          asChild
          onContextMenu={(event) => {
            const next = menu(event);
            // Radix opens only when the event is not prevented; preventing it also keeps the
            // shell's text menu away.
            if (next === undefined || next.actions.length === 0) event.preventDefault();
            else setContent(next);
          }}
        >
          {children}
        </RightClick.Trigger>
        {content === undefined ? null : (
          <RightClick.Portal>
            <RightClick.Content className={styles.surface}>
              <Items content={content} parts={RightClick} icons onDialog={open} />
            </RightClick.Content>
          </RightClick.Portal>
        )}
      </RightClick.Root>
      {dialog}
    </>
  );
}

export function MoreMenu({ menu, label }: { menu: () => MenuContent | undefined; label: string }) {
  const { open, dialog } = useActionDialog();
  const [content, setContent] = useState<MenuContent>();
  return (
    <>
      <DropdownMenu.Root onOpenChange={(next) => setContent(next ? menu() : undefined)}>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" icon aria-label={label}>
            <MoreHorizontal size={14} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        {content === undefined ? null : (
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={styles.surface} align="end" sideOffset={4}>
              <Items
                content={{ actions: content.actions }}
                parts={DropdownMenu}
                icons={false}
                onDialog={open}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </DropdownMenu.Root>
      {dialog}
    </>
  );
}
