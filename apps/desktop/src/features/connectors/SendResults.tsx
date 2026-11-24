import type {
  DestinationKind,
  DestinationRecord,
  DestinationSettings,
  TelegramCode,
} from "@office-town/contract";
import { ArrowLeft, Pencil, Plus, Send, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { confirmed, MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { SERVICES, serviceLabel, useDestinations } from "./destinations.ts";
import { ConnectorSheet } from "./SheetParts.tsx";

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

function statusOf(destination: DestinationRecord): string {
  if (destination.problem !== undefined) return destination.problem;
  if (destination.settings.kind === "telegram") {
    return destination.link === undefined
      ? "Telegram. Link your chat to get results there."
      : `Telegram, linked to ${destination.link.name}.`;
  }
  return SERVICES[destination.settings.kind].description;
}

// The fields a service's settings keep, with their defaults.
function settingsOf(kind: DestinationKind, values: Record<string, string>): DestinationSettings {
  switch (kind) {
    case "ntfy":
      return { kind, server: values.server?.trim() || "https://ntfy.sh" };
    case "email":
      return {
        kind,
        to: values.to?.trim() ?? "",
        ...(values.from?.trim() ? { from: values.from.trim() } : {}),
      };
    default:
      return { kind } as DestinationSettings;
  }
}

function settingValues(settings: DestinationSettings): Record<string, string> {
  if (settings.kind === "ntfy") return { server: settings.server };
  if (settings.kind === "email") return { to: settings.to, from: settings.from ?? "" };
  return {};
}

interface SendSheetProps {
  kind: DestinationKind;
  editing?: DestinationRecord;
  // Back to the Add list it was picked from.
  onBack?: () => void;
  onClose: () => void;
}

// Adding pastes every key; editing keeps the saved ones unless new ones are pasted. The core sends,
// never an agent, so a result, a failure or an ask arrives on any provider (D-130).
export function SendSheet({ kind, editing, onBack, onClose }: SendSheetProps) {
  const service = SERVICES[kind];
  const [name, setName] = useState(editing?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>(
    editing === undefined ? {} : settingValues(editing.settings),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fields = [...service.keys, ...(service.settings ?? [])];
  const save = async () => {
    setBusy(true);
    setError(undefined);
    const keys = Object.fromEntries(
      service.keys.flatMap(({ key }) => (values[key]?.trim() ? [[key, values[key].trim()]] : [])),
    );
    const request = {
      name: name.trim() || service.label,
      settings: settingsOf(kind, values),
      ...(editing !== undefined && Object.keys(keys).length === 0 ? {} : { keys }),
    };
    try {
      if (editing === undefined) {
        await api.addDestination(request);
        showToast(
          kind === "telegram"
            ? "Added. Link your chat from its row."
            : `Added ${request.name}. Send a test from its row.`,
        );
      } else {
        await api.updateDestination(editing.id, request);
      }
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConnectorSheet
      logo={
        onBack === undefined ? (
          <AppLogo app={service.label} />
        ) : (
          <Button variant="ghost" icon aria-label="Back to the list" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden />
          </Button>
        )
      }
      title={editing === undefined ? `Add ${service.label}` : `Edit ${editing.name}`}
      by="Automations send their results, failures and asks here"
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <p className={styles.note}>{service.hint}</p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <input
          className={page.input}
          value={name}
          placeholder={service.label}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {fields.map((field) => (
        <label key={field.key} className={styles.field}>
          <span className={styles.fieldLabel}>
            {field.label}
            {field.optional ? " (optional)" : ""}
          </span>
          <input
            className={page.input}
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            value={values[field.key] ?? ""}
            placeholder={
              field.secret && editing !== undefined
                ? "Saved. Paste a new one to replace it."
                : field.key === "server"
                  ? "https://ntfy.sh"
                  : undefined
            }
            onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
          />
        </label>
      ))}
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </ConnectorSheet>
  );
}

function TelegramLinking({ code }: { code: TelegramCode }) {
  return (
    <span className={styles.sendCode}>
      Send <strong>{code.code}</strong> to your bot in Telegram within 10 minutes.
      {code.url === undefined ? null : (
        <a className={styles.link} href={code.url} target="_blank" rel="noreferrer">
          Open in Telegram
        </a>
      )}
    </span>
  );
}

function SendRow({ destination, onEdit }: { destination: DestinationRecord; onEdit: () => void }) {
  const [testing, setTesting] = useState(false);
  const [code, setCode] = useState<TelegramCode>();
  const linkable = destination.settings.kind === "telegram" && destination.link === undefined;
  const test = async () => {
    setTesting(true);
    try {
      await api.testDestination(destination.id);
      showToast(`Sent a test to ${destination.name}`);
    } catch (failure) {
      showToast(errorText(failure));
    } finally {
      setTesting(false);
    }
  };
  const link = async () => {
    try {
      setCode(await api.linkTelegram(destination.id));
    } catch (failure) {
      showToast(errorText(failure));
    }
  };
  return (
    <li className={`${styles.connRow} ${styles.staticRow}`}>
      <AppLogo app={serviceLabel(destination)} />
      <span className={styles.connText}>
        <span className={styles.connName}>{destination.name}</span>
        {linkable && code !== undefined ? (
          <TelegramLinking code={code} />
        ) : (
          <span
            className={`${styles.sendStatus} ${destination.problem === undefined ? "" : styles.warn}`}
          >
            {statusOf(destination)}
          </span>
        )}
      </span>
      <span className={styles.rowEnd}>
        {linkable ? (
          <Button onClick={() => void link()}>{code === undefined ? "Link" : "New code"}</Button>
        ) : (
          <Button busy={testing} onClick={() => void test()}>
            <Send size={14} aria-hidden />
            Send a test
          </Button>
        )}
        <MoreMenu
          label={`More for ${destination.name}`}
          menu={() => ({
            actions: [
              { label: "Edit", icon: Pencil, run: onEdit },
              ...(destination.link === undefined
                ? []
                : [
                    {
                      label: "Unlink chat",
                      icon: Unlink,
                      run: async () => {
                        await api.unlinkTelegram(destination.id);
                      },
                    },
                  ]),
              confirmed(
                { label: "Remove", icon: Trash2 },
                {
                  title: `Remove ${destination.name}?`,
                  description:
                    "Automations stop sending to it. Its key is deleted from this computer.",
                  confirmLabel: "Remove",
                  run: () => api.removeDestination(destination.id),
                },
              ),
            ],
          })}
        />
      </span>
    </li>
  );
}

// Where automations send their results, on the same page as the apps agents use. Shown once one
// is set up; Add lists the services (D-130).
export function SendResults({ onAdd }: { onAdd: () => void }) {
  const destinations = useDestinations();
  const [editing, setEditing] = useState<DestinationRecord>();
  if (destinations === undefined || destinations.length === 0) return null;
  return (
    <div className={page.section}>
      <div className={page.sectionHead}>
        <h2 className={page.sectionTitle}>Send results to</h2>
        <Button variant="ghost" onClick={onAdd}>
          <Plus size={14} aria-hidden />
          Add
        </Button>
      </div>
      <ul className={styles.list} aria-label="Send results to">
        {destinations.map((destination) => (
          <SendRow
            key={destination.id}
            destination={destination}
            onEdit={() => setEditing(destination)}
          />
        ))}
      </ul>
      {editing === undefined ? null : (
        <SendSheet
          kind={editing.settings.kind}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
