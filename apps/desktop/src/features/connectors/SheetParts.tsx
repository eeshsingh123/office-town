import type { Audience, ConnectorKey, ConnectorPermission } from "@office-town/contract";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import page from "../../ui/Page.module.css";
import { AudienceMenu, useHolders } from "../library/GivenToMenu.tsx";
import { EVERYONE } from "../library/library.ts";
import styles from "./Connectors.module.css";
import { PERMISSIONS } from "./connectors.ts";

interface ConnectorSheetProps {
  logo: ReactNode;
  title: string;
  by: ReactNode;
  children: ReactNode;
  foot: ReactNode;
  onClose: () => void;
}

export function ConnectorSheet({ logo, title, by, children, foot, onClose }: ConnectorSheetProps) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dim} />
        <Dialog.Content className={styles.sheet} aria-describedby={undefined}>
          <div className={styles.sheetHead}>
            {logo}
            <span className={styles.sheetHeadText}>
              <Dialog.Title className={styles.sheetTitle}>{title}</Dialog.Title>
              <span className={styles.by}>{by}</span>
            </span>
            <Dialog.Close asChild>
              <Button variant="ghost" icon aria-label="Close">
                <X size={16} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <div className={styles.sheetBody}>{children}</div>
          <div className={styles.sheetFoot}>{foot}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <p className={styles.fieldLabel}>{label}</p>
      {children}
    </div>
  );
}

const NO_ONE: Audience = { everyone: false, departmentIds: [], agentIds: [] };

// Everyone, or the departments and agents picked with the Library's menu.
export function WhoField({
  audience,
  onChange,
}: {
  audience: Audience;
  onChange: (audience: Audience) => void;
}) {
  const holders = useHolders();
  return (
    <Field label="Who can use it">
      <OptionRows
        name="connector-who"
        label="Who can use it"
        value={audience.everyone ? "everyone" : "some"}
        options={[
          { value: "everyone", title: "Everyone" },
          {
            value: "some",
            title: "Only some",
            ...(audience.everyone
              ? {}
              : {
                  description: (
                    <span className={styles.picker}>
                      <AudienceMenu
                        audience={audience}
                        holders={holders}
                        onChange={onChange}
                        everyone="Every agent, in any department"
                        empty="There are no departments yet."
                        label="Can use it:"
                      />
                    </span>
                  ),
                }),
          },
        ]}
        onChange={(value) => onChange(value === "everyone" ? EVERYONE : NO_ONE)}
      />
    </Field>
  );
}

export function PermissionField({
  value,
  onChange,
}: {
  value: ConnectorPermission;
  onChange: (permission: ConnectorPermission) => void;
}) {
  return (
    <Field label="Permissions">
      <OptionRows
        name="connector-permission"
        label="Permissions"
        value={value}
        options={PERMISSIONS.map(({ value, title, description }) => ({
          value,
          title,
          description,
        }))}
        onChange={onChange}
      />
    </Field>
  );
}

// One field per key the app takes; the values go to the computer's credential store.
export function KeyFields({
  keys,
  values,
  onChange,
  keysInFile,
}: {
  keys: ConnectorKey[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  keysInFile: boolean;
}) {
  return (
    <>
      {keys.map((key) => (
        <label key={key.name} className={styles.field}>
          <span className={styles.fieldLabel}>{key.label}</span>
          <input
            className={page.input}
            type="password"
            autoComplete="off"
            value={values[key.name] ?? ""}
            onChange={(event) => onChange({ ...values, [key.name]: event.target.value })}
          />
          {key.link === undefined ? null : (
            <a className={styles.link} href={key.link} target="_blank" rel="noreferrer">
              Where to find it
            </a>
          )}
        </label>
      ))}
      {keys.length > 0 && keysInFile ? (
        <p className={styles.note}>
          This computer has no password store, so keys are kept in a file only you can read.
        </p>
      ) : null}
    </>
  );
}
