import {
  type DestinationKind,
  type DestinationRecord,
  type DestinationSettings,
  pasteFits,
  type TelegramCode,
} from "@office-town/contract";
import { ArrowLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import page from "../../ui/Page.module.css";
import connectors from "../connectors/Connectors.module.css";
import { ConnectorSheet } from "../connectors/SheetParts.tsx";
import { GUIDES } from "./guides/all.ts";
import type { PasteField, ServiceGuide } from "./guides/guide.ts";
import { ServiceLogo } from "./PlaceTag.tsx";
import { closeConnect, errorText, useConnectRequest } from "./places.ts";
import styles from "./Updates.module.css";

// Drawn once for the whole app; openConnect() shows it over the page the user is on.
export function ConnectHost() {
  const request = useConnectRequest();
  const [kind, setKind] = useState<DestinationKind>();
  // A new request starts from what it asked for.
  useEffect(() => setKind(request?.kind ?? request?.editing?.settings.kind), [request]);
  if (request === undefined) return null;
  if (kind === undefined) return <ChooseService onPick={setKind} />;
  const chosenHere = request.kind === undefined && request.editing === undefined;
  return (
    <ConnectService
      key={kind}
      guide={GUIDES[kind]}
      {...(request.editing === undefined ? {} : { editing: request.editing })}
      {...(chosenHere ? { onBack: () => setKind(undefined) } : {})}
      {...(request.onConnected === undefined ? {} : { onConnected: request.onConnected })}
    />
  );
}

function ChooseService({ onPick }: { onPick: (kind: DestinationKind) => void }) {
  const guides = Object.values(GUIDES);
  const button = (guide: ServiceGuide) => (
    <button
      key={guide.kind}
      type="button"
      className={styles.serviceButton}
      onClick={() => onPick(guide.kind)}
    >
      <ServiceLogo kind={guide.kind} size="md" />
      {guide.label}
    </button>
  );
  return (
    <ConnectorSheet
      logo={null}
      title="Connect a place"
      onClose={closeConnect}
      foot={
        <Button variant="ghost" onClick={closeConnect}>
          Close
        </Button>
      }
    >
      <div className={styles.services}>
        {guides.filter((guide) => guide.more !== true).map(button)}
        <p className={styles.moreLabel}>More ways</p>
        {guides.filter((guide) => guide.more === true).map(button)}
      </div>
    </ConnectorSheet>
  );
}

function settingsOf(kind: DestinationKind, values: Record<string, string>): DestinationSettings {
  if (kind !== "email") return { kind } as DestinationSettings;
  const from = values.from?.trim();
  return { kind, to: values.to?.trim() ?? "", ...(from ? { from } : {}) };
}

function plainValues(settings: DestinationSettings): Record<string, string> {
  return settings.kind === "email" ? { to: settings.to, from: settings.from ?? "" } : {};
}

// Why a paste is wrong, and the step that shows the right one; nothing while it fits.
function wrongPaste(guide: ServiceGuide, field: PasteField, value: string) {
  if (value.trim() === "" || pasteFits(guide.kind, field.key, value)) return undefined;
  return field.wrong?.(value.trim());
}

type Outcome = { ok: boolean; text: string };

interface ConnectServiceProps {
  guide: ServiceGuide;
  editing?: DestinationRecord;
  onBack?: () => void;
  onConnected?: (placeId: string) => void;
}

// Steps, one paste checked as it is made, and Save, which sends a test at once.
function ConnectService({ guide, editing, onBack, onConnected }: ConnectServiceProps) {
  const [placeId, setPlaceId] = useState(editing?.id);
  const place = useApp((state) => (placeId === undefined ? undefined : state.places?.[placeId]));
  const [name, setName] = useState(editing?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>(
    editing === undefined ? {} : plainValues(editing.settings),
  );
  const [guideOpen, setGuideOpen] = useState(editing === undefined);
  const [pointed, setPointed] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [code, setCode] = useState<TelegramCode>();

  const wrong = guide.fields
    .map((field) => wrongPaste(guide, field, values[field.key] ?? ""))
    .find((found) => found !== undefined);
  const missing = guide.fields.some(
    (field) =>
      field.optional !== true &&
      (values[field.key] ?? "").trim() === "" &&
      (field.plain === true || placeId === undefined),
  );
  const linking = guide.kind === "telegram" && place !== undefined && place.link === undefined;
  const linked = code !== undefined && place?.link !== undefined;

  const point = (step: number) => {
    setGuideOpen(true);
    setPointed(step);
  };

  const test = async (id: string) => {
    try {
      await api.testDestination(id);
      setOutcome({ ok: true, text: "Connected. Check that the test message arrived." });
    } catch (failure) {
      setOutcome({ ok: false, text: errorText(failure) });
      if (guide.steps.length > 0) point(guide.steps.length - 1);
    }
  };

  // The chat is linked once the code reaches the bot; the change arrives live.
  const tested = useRef(false);
  useEffect(() => {
    if (!linked || place === undefined || tested.current) return;
    tested.current = true;
    void test(place.id);
  });

  const newCode = async (id: string) => {
    try {
      setCode(await api.linkTelegram(id));
    } catch (failure) {
      setOutcome({ ok: false, text: errorText(failure) });
    }
  };

  const save = async () => {
    if (wrong !== undefined) return point(wrong.step);
    setBusy(true);
    setOutcome(undefined);
    const keys = Object.fromEntries(
      guide.fields.flatMap(({ key, plain }) =>
        plain !== true && values[key]?.trim() ? [[key, values[key].trim()]] : [],
      ),
    );
    const request = {
      name: name.trim() || guide.label,
      settings: settingsOf(guide.kind, values),
      ...(Object.keys(keys).length === 0 ? {} : { keys }),
    };
    try {
      let saved: DestinationRecord;
      if (placeId === undefined) {
        saved = await api.addDestination(request);
        setPlaceId(saved.id);
        onConnected?.(saved.id);
      } else {
        saved = await api.updateDestination(placeId, request);
      }
      if (guide.kind === "telegram" && saved.link === undefined) await newCode(saved.id);
      else await test(saved.id);
    } catch (failure) {
      setOutcome({ ok: false, text: errorText(failure) });
    } finally {
      setBusy(false);
    }
  };

  const done = outcome?.ok === true;
  return (
    <ConnectorSheet
      logo={
        onBack === undefined || placeId !== undefined ? (
          <ServiceLogo kind={guide.kind} size="md" />
        ) : (
          <Button variant="ghost" icon aria-label="Back to the list" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden />
          </Button>
        )
      }
      title={editing === undefined ? `Connect ${guide.label}` : `Edit ${editing.name}`}
      onClose={closeConnect}
      foot={
        done ? (
          <Button variant="primary" onClick={closeConnect}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={closeConnect}>
              {linking ? "Later" : "Cancel"}
            </Button>
            {linking && code !== undefined ? null : (
              <Button
                variant="primary"
                busy={busy}
                disabled={missing || wrong !== undefined}
                onClick={() => void save()}
              >
                Save
              </Button>
            )}
          </>
        )
      }
    >
      {done ? null : linking && code !== undefined ? (
        <LinkChat code={code} onNewCode={() => void newCode(place.id)} />
      ) : (
        <>
          {guide.steps.length === 0 ? null : (
            <Guide
              guide={guide}
              open={guideOpen}
              pointed={pointed}
              onToggle={(open) => setGuideOpen(open)}
            />
          )}
          {guide.hint === undefined ? null : <p className={connectors.note}>{guide.hint}</p>}
          {guide.fields.map((field) => {
            const problem = wrongPaste(guide, field, values[field.key] ?? "");
            return (
              <label key={field.key} className={connectors.field}>
                <span className={connectors.fieldLabel}>
                  {field.label}
                  {field.optional ? " (optional)" : ""}
                </span>
                <input
                  className={page.input}
                  type={field.plain ? "text" : "password"}
                  autoComplete="off"
                  aria-invalid={problem !== undefined}
                  value={values[field.key] ?? ""}
                  placeholder={
                    field.plain !== true && placeId !== undefined
                      ? "Saved. Paste a new one to replace it."
                      : undefined
                  }
                  onChange={(event) => {
                    const next = { ...values, [field.key]: event.target.value };
                    setValues(next);
                    const found = wrongPaste(guide, field, event.target.value);
                    if (found !== undefined) point(found.step);
                  }}
                />
                {problem === undefined ? null : (
                  <span className={`${styles.outcome} ${styles.bad}`} role="alert">
                    {problem.say}
                  </span>
                )}
              </label>
            );
          })}
          <label className={connectors.field}>
            <span className={connectors.fieldLabel}>Name (optional)</span>
            <input
              className={page.input}
              value={name}
              placeholder={guide.label}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </>
      )}
      {outcome === undefined ? null : (
        <p
          className={`${styles.outcome} ${outcome.ok ? styles.ok : styles.bad}`}
          role={outcome.ok ? "status" : "alert"}
        >
          {linked && outcome.ok ? `Linked to ${place?.link?.name}. ` : ""}
          {outcome.text}
        </p>
      )}
    </ConnectorSheet>
  );
}

function Guide({
  guide,
  open,
  pointed,
  onToggle,
}: {
  guide: ServiceGuide;
  open: boolean;
  pointed: number | undefined;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      className={styles.guide}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className={styles.guideLine}>
        <ChevronRight size={14} aria-hidden className={styles.chevron} />
        How to connect
      </summary>
      <ol className={styles.steps}>
        {guide.steps.map((step, index) => (
          <li
            key={step.text}
            className={styles.step}
            aria-current={index === pointed ? "step" : undefined}
          >
            <span className={styles.stepBody}>
              <span className={index === pointed ? styles.stepOn : undefined}>{step.text}</span>
              {step.open === undefined ? null : (
                <a
                  className={connectors.link}
                  href={step.open.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {step.open.label} <ExternalLink size={12} aria-hidden />
                </a>
              )}
              {step.picture === undefined ? null : (
                <span role="img" aria-label={step.picture.alt}>
                  <step.picture.draw />
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

// After Save: the bot only knows the chat once the user sends it the code.
function LinkChat({ code, onNewCode }: { code: TelegramCode; onNewCode: () => void }) {
  return (
    <div className={connectors.field}>
      <span className={connectors.fieldLabel}>Link your chat</span>
      <p className={connectors.note}>
        Open your bot in Telegram and press Start, or send it{" "}
        <span className={styles.code}>{code.code}</span> within 10 minutes.
      </p>
      <p className={connectors.note} role="status">
        Waiting for your chat…
      </p>
      <span className={styles.rowEnd}>
        {code.url === undefined ? null : (
          <a className={connectors.link} href={code.url} target="_blank" rel="noreferrer">
            Open in Telegram <ExternalLink size={12} aria-hidden />
          </a>
        )}
        <Button variant="ghost" onClick={onNewCode}>
          New code
        </Button>
      </span>
    </div>
  );
}
