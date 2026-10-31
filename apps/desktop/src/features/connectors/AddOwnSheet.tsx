import type {
  Audience,
  ConnectorAuth,
  ConnectorCatalog,
  ConnectorFound,
  ConnectorPermission,
  ConnectorSetup,
  RoleSettings,
} from "@office-town/contract";
import { BadgeCheck, Check, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { clearDrafts, ignoreDraft, shaped, useDraft } from "../../store/drafts.ts";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import page from "../../ui/Page.module.css";
import { DraftBox } from "../drafts/DraftBox.tsx";
import { EVERYONE, givenToSomeone } from "../library/library.ts";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { ClaudeSteps } from "./ConnectSheet.tsx";
import { openClaudeConnectors } from "./connectors.ts";
import { ConnectorSheet, Field, KeyFields, PermissionField, WhoField } from "./SheetParts.tsx";

interface AddOwnSheetProps {
  keysAt: ConnectorCatalog["keys"];
  // The words to look for, such as an app an agent asked for.
  describe?: string;
  audience?: Audience;
  onClose: () => void;
}

export interface OwnSetup {
  name: string;
  kind: "remote" | "local";
  url: string;
  command: string;
  args: string;
  auth: ConnectorAuth;
  // The header or variable a key fills.
  keyName: string;
}

const EMPTY: OwnSetup = {
  name: "",
  kind: "remote",
  url: "",
  command: "",
  args: "",
  auth: "none",
  keyName: "Authorization",
};

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 24) || "app";

// Arguments split on spaces, keeping quoted parts whole.
const argsOf = (text: string) =>
  [...text.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? "");

export function setupOf(own: OwnSetup, extra: Partial<ConnectorSetup> = {}): ConnectorSetup {
  const keyed = own.auth === "key" && own.keyName.trim() !== "";
  return {
    slug: slugOf(own.name),
    name: own.name.trim(),
    kind: own.kind,
    official: false,
    ...(own.kind === "remote"
      ? { url: own.url.trim() }
      : { command: own.command.trim(), args: argsOf(own.args) }),
    auth: own.auth,
    keys: keyed ? [{ name: own.keyName.trim(), label: "Key" }] : [],
    ...extra,
  };
}

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

function ownOf({ setup }: ConnectorFound): OwnSetup {
  return {
    name: setup.name,
    kind: setup.kind === "local" ? "local" : "remote",
    url: setup.url ?? "",
    command: setup.command ?? "",
    args: (setup.args ?? []).map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" "),
    auth: setup.auth,
    keyName: setup.keys[0]?.name ?? (setup.kind === "remote" ? "Authorization" : ""),
  };
}

// Who made what the draft found; its key's label and link stay while the key is unchanged.
function foundExtra(found: ConnectorFound | undefined, own: OwnSetup): Partial<ConnectorSetup> {
  if (found === undefined) return {};
  const { setup } = found;
  const sameKeys = own.auth === setup.auth && own.keyName === setup.keys[0]?.name;
  return {
    official: setup.official,
    ...(setup.maker === undefined ? {} : { maker: setup.maker }),
    ...(sameKeys ? { keys: setup.keys } : {}),
  };
}

interface HandProps {
  own: OwnSetup;
  change: (next: Partial<OwnSetup>) => void;
  setup: ConnectorSetup;
  keys: Record<string, string>;
  setKeys: (keys: Record<string, string>) => void;
  keysAt: ConnectorCatalog["keys"];
}

function HandFields({ own, change, setup, keys, setKeys, keysAt }: HandProps) {
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <input
          className={page.input}
          value={own.name}
          placeholder="Blender"
          onChange={(event) => change({ name: event.target.value })}
        />
      </label>
      <Field label="Where it runs">
        <OptionRows
          name="own-kind"
          label="Where it runs"
          value={own.kind}
          options={[
            { value: "remote", title: "On the internet", description: "An address to connect to" },
            { value: "local", title: "On this computer", description: "A program the app starts" },
          ]}
          onChange={(kind) =>
            change({ kind, auth: "none", keyName: kind === "remote" ? "Authorization" : "" })
          }
        />
      </Field>
      {own.kind === "remote" ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Address</span>
          <input
            className={page.input}
            value={own.url}
            placeholder="https://example.com/mcp"
            onChange={(event) => change({ url: event.target.value })}
          />
        </label>
      ) : (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Command</span>
            <input
              className={page.input}
              value={own.command}
              placeholder="uvx"
              onChange={(event) => change({ command: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Arguments</span>
            <input
              className={page.input}
              value={own.args}
              placeholder="blender-mcp"
              onChange={(event) => change({ args: event.target.value })}
            />
          </label>
        </>
      )}
      <Field label="Signing in">
        <OptionRows
          name="own-auth"
          label="Signing in"
          value={own.auth}
          options={[
            { value: "none", title: "Nothing needed" },
            { value: "key", title: "A key" },
          ]}
          onChange={(auth) => change({ auth })}
        />
        {own.auth === "key" ? (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {own.kind === "remote" ? "Header it goes in" : "Variable it goes in"}
              </span>
              <input
                className={page.input}
                value={own.keyName}
                onChange={(event) => change({ keyName: event.target.value })}
              />
            </label>
            <KeyFields keys={setup.keys} values={keys} onChange={setKeys} keysAt={keysAt} />
          </>
        ) : null}
      </Field>
    </>
  );
}

function Found({ found, tested }: { found: ConnectorFound; tested: number | undefined }) {
  const { setup, source, installFirst } = found;
  return (
    <div className={styles.found}>
      <div className={styles.foundHead}>
        <AppLogo app={setup.slug} />
        <span className={styles.accountText}>
          <b>{setup.name}</b>
          <span className={styles.by}>
            {setup.official ? (
              <>
                <BadgeCheck size={13} aria-hidden />
                Official, by {setup.maker}
              </>
            ) : (
              "Community"
            )}
          </span>
        </span>
        {tested === undefined ? null : (
          <span className={styles.tested}>
            <Check size={14} aria-hidden />
            Tested
          </span>
        )}
      </div>
      <div className={styles.foundRow}>
        <span className={styles.foundKey}>Source</span>
        <a className={styles.link} href={source} target="_blank" rel="noreferrer">
          {source.replace(/^https?:[/][/]/, "")}
        </a>
      </div>
      <div className={styles.foundRow}>
        <span className={styles.foundKey}>Runs</span>
        {setup.kind === "claude" ? (
          <span>In Claude, which signs you in</span>
        ) : setup.kind === "remote" ? (
          <span>On the internet</span>
        ) : (
          <span>
            On this computer:{" "}
            <span className={styles.code}>{[setup.command, ...(setup.args ?? [])].join(" ")}</span>
          </span>
        )}
      </div>
      {installFirst === undefined ? null : (
        <div className={styles.foundRow}>
          <span className={styles.foundKey}>Install first</span>
          <span>{installFirst}</span>
        </div>
      )}
      {tested === undefined ? null : (
        <div className={styles.foundRow}>
          <span className={styles.foundKey}>Gives agents</span>
          <span>{tested} actions</span>
        </div>
      )}
    </div>
  );
}

// Describe the app and a short run finds an existing server and sets it up; or enter it by hand.
export function AddOwnSheet({ keysAt, describe, audience: asked, onClose }: AddOwnSheetProps) {
  // Each app asked for has its own draft. Keys are never written down, and a test goes with them.
  const draft = describe === undefined ? "connector" : `connector-asked.${describe}`;
  const [own, setOwn] = useDraft<OwnSetup>(`${draft}.own`, EMPTY);
  const [found, setFound] = useDraft<ConnectorFound | undefined>(`${draft}.found`, undefined);
  const [byHand, setByHand] = useDraft(`${draft}.byHand`, false);
  const [audience, setAudience] = useDraft<Audience>(
    `${draft}.audience`,
    asked ?? EVERYONE,
    asked === undefined ? shaped({}) : ignoreDraft,
  );
  const [permission, setPermission] = useDraft<ConnectorPermission>(`${draft}.permission`, "ask");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [tested, setTested] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const change = (next: Partial<OwnSetup>) => {
    setOwn({ ...own, ...next });
    setTested(undefined);
  };
  const setup = setupOf(own, foundExtra(found, own));
  const filled =
    setup.name !== "" &&
    (own.kind === "remote" ? own.url.trim() !== "" : own.command.trim() !== "");
  // An app that signs in through the browser is added on claude.ai instead (D-68).
  const inClaude = !byHand && found?.setup.kind === "claude";
  const ready = filled && givenToSomeone(audience) && tested !== undefined;
  const shown = byHand || (found !== undefined && !inClaude);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  const find = async (notes: string[], drafter: RoleSettings) => {
    const reply = await api.draftConnector({ notes, drafter });
    if (reply.found !== undefined) {
      setFound(reply.found);
      setOwn(ownOf(reply.found));
      setTested(undefined);
    }
    return reply;
  };
  const finish = () => {
    clearDrafts(draft);
    onClose();
  };
  const test = () => run(async () => setTested(await api.testConnector({ setup, keys })));
  const add = () =>
    run(async () => {
      await api.addConnector({ setup, audience, permission, keys });
      finish();
    });

  return (
    <ConnectorSheet
      logo={
        <span className={`${styles.logo} ${styles.md} ${styles.plus}`} aria-hidden>
          <Plus size={16} />
        </span>
      }
      title="Add your own"
      by="Describe the app, or enter its details"
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" className={styles.footLeft} onClick={() => setByHand(!byHand)}>
            {byHand ? "Describe it instead" : "Enter details by hand"}
          </Button>
          <Button variant="ghost" onClick={finish}>
            Cancel
          </Button>
          {inClaude ? (
            <Button
              variant="primary"
              onClick={() => {
                openClaudeConnectors();
                finish();
              }}
            >
              Open Claude
            </Button>
          ) : (
            <Button variant="primary" disabled={!ready || busy} onClick={add}>
              Add connector
            </Button>
          )}
        </>
      }
    >
      {byHand ? (
        <HandFields
          own={own}
          change={change}
          setup={setup}
          keys={keys}
          setKeys={setKeys}
          keysAt={keysAt}
        />
      ) : (
        <>
          <Field label="What should your agents be able to use?">
            <DraftBox
              name={`${draft}.box`}
              label="What should your agents be able to use?"
              placeholder="Let my agents build 3D scenes in Blender."
              action="Find it"
              drafted={found !== undefined}
              changePlaceholder="Say what to change, for example: use the official one"
              {...(describe === undefined ? {} : { initial: describe })}
              run={find}
            />
          </Field>
          {found === undefined ? null : (
            <>
              <Field label="Found">
                <Found found={found} tested={tested} />
              </Field>
              {inClaude ? <ClaudeSteps setup={found.setup} /> : null}
              {setup.auth === "key" ? (
                <KeyFields keys={setup.keys} values={keys} onChange={setKeys} keysAt={keysAt} />
              ) : null}
            </>
          )}
        </>
      )}
      {shown ? (
        <>
          <WhoField audience={audience} onChange={setAudience} />
          <PermissionField value={permission} onChange={setPermission} />
          <Field label="Test">
            {own.kind === "local" && filled ? (
              <p className={styles.note}>
                Runs{" "}
                <span className={styles.code}>
                  {[setup.command, ...(setup.args ?? [])].join(" ")}
                </span>{" "}
                on this computer.
              </p>
            ) : null}
            <div className={styles.account}>
              <span className={styles.accountText}>
                {tested === undefined ? (
                  <span className={styles.sub}>Connects once and lists what it offers.</span>
                ) : (
                  <span className={styles.tested}>
                    <Check size={14} aria-hidden />
                    Tested: {tested} actions
                  </span>
                )}
              </span>
              <Button disabled={!filled || busy} onClick={test}>
                {own.kind === "local" ? "Run and test" : "Test"}
              </Button>
            </div>
          </Field>
        </>
      ) : null}
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </ConnectorSheet>
  );
}
