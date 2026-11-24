import type {
  DestinationKind,
  DestinationRecord,
  DestinationSettings,
  TelegramCode,
} from "@office-town/contract";
import { Pencil, Send, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { confirmed, MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import form from "../../ui/Form.module.css";
import { SettingRow } from "../../ui/Switch.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { SERVICES, serviceLabel, useDestinations } from "./destinations.ts";
import styles from "./Settings.module.css";

const KINDS = Object.entries(SERVICES).map(([value, service]) => ({
  value: value as DestinationKind,
  label: service.label,
}));

const say = (failure: unknown) =>
  showToast(failure instanceof Error ? failure.message : String(failure));

function statusOf(destination: DestinationRecord): string {
  if (destination.problem !== undefined) return destination.problem;
  if (destination.settings.kind === "telegram") {
    return destination.link === undefined
      ? "Telegram. Link your chat to get messages and answer from there."
      : `Telegram, linked to ${destination.link.name}. Answers come back from there.`;
  }
  return serviceLabel(destination);
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

// Adding pastes every key; editing keeps the saved ones unless new ones are pasted.
function DestinationForm({ editing, onDone }: { editing?: DestinationRecord; onDone: () => void }) {
  const [kind, setKind] = useState<DestinationKind>(editing?.settings.kind ?? "telegram");
  const [name, setName] = useState(editing?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>(
    editing === undefined ? {} : settingValues(editing.settings),
  );
  const [busy, setBusy] = useState(false);
  const service = SERVICES[kind];
  const fields = [...service.keys, ...(service.settings ?? [])];
  const save = async () => {
    setBusy(true);
    const keys = Object.fromEntries(
      service.keys.flatMap(({ key }) => (values[key]?.trim() ? [[key, values[key].trim()]] : [])),
    );
    const request = {
      name: name.trim() || service.label,
      settings: settingsOf(kind, values),
      ...(editing !== undefined && Object.keys(keys).length === 0 ? {} : { keys }),
    };
    try {
      if (editing === undefined) await api.addDestination(request);
      else await api.updateDestination(editing.id, request);
      onDone();
    } catch (failure) {
      say(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.destinationForm}>
      {editing === undefined ? (
        <SettingRow label="Service" hint={service.hint}>
          <ChoiceMenu label="Service" value={kind} choices={KINDS} onChange={setKind} />
        </SettingRow>
      ) : null}
      <label className={form.field}>
        <span className={form.label}>Name</span>
        <input
          className={form.input}
          value={name}
          placeholder={service.label}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {fields.map((field) => (
        <label key={field.key} className={form.field}>
          <span className={form.label}>
            {field.label}
            {field.optional ? " (optional)" : ""}
          </span>
          <input
            className={form.input}
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
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

function TelegramLinking({ code }: { code: TelegramCode }) {
  return (
    <span className={styles.code}>
      Send <strong>{code.code}</strong> to your bot in Telegram.
      {code.url === undefined ? null : (
        <a className={styles.link} href={code.url} target="_blank" rel="noreferrer">
          Open in Telegram
        </a>
      )}
    </span>
  );
}

function DestinationRow({
  destination,
  onEdit,
}: {
  destination: DestinationRecord;
  onEdit: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [code, setCode] = useState<TelegramCode>();
  const linkable = destination.settings.kind === "telegram" && destination.link === undefined;
  const test = async () => {
    setTesting(true);
    try {
      await api.testDestination(destination.id);
      showToast(`Sent a test to ${destination.name}`);
    } catch (failure) {
      say(failure);
    } finally {
      setTesting(false);
    }
  };
  const link = async () => {
    try {
      setCode(await api.linkTelegram(destination.id));
    } catch (failure) {
      say(failure);
    }
  };
  return (
    <SettingRow
      label={destination.name}
      hint={
        linkable && code !== undefined ? <TelegramLinking code={code} /> : statusOf(destination)
      }
    >
      <span className={styles.actions}>
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
    </SettingRow>
  );
}

// Where automations send their results, set up once by pasting a key (D-130).
export function DestinationRows() {
  const destinations = useDestinations();
  const [editing, setEditing] = useState<string | "new">();
  if (destinations === undefined) return null;
  return (
    <>
      {destinations.map((destination) =>
        editing === destination.id ? (
          <DestinationForm
            key={destination.id}
            editing={destination}
            onDone={() => setEditing(undefined)}
          />
        ) : (
          <DestinationRow
            key={destination.id}
            destination={destination}
            onEdit={() => setEditing(destination.id)}
          />
        ),
      )}
      {editing === "new" ? (
        <DestinationForm onDone={() => setEditing(undefined)} />
      ) : (
        <SettingRow
          label={destinations.length === 0 ? "No destinations yet" : "Add another"}
          hint="Automations can send their results to Telegram, Slack, Discord, ntfy, email or a webhook."
        >
          <Button onClick={() => setEditing("new")}>Add a destination</Button>
        </SettingRow>
      )}
    </>
  );
}
