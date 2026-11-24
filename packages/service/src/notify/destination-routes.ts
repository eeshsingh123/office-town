import { randomBytes } from "node:crypto";
import {
  type DestinationCreated,
  type DestinationKeys,
  type DestinationKind,
  type DestinationList,
  type DestinationSettings,
  destinationRequestSchema,
  NEW_PLACE_HEARS,
  type PhoneChannel,
  pasteFits,
  type Settings,
  type Updates,
  updatesRequestSchema,
} from "@office-town/contract";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import { writeKeys } from "../connectors/secrets.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { DESTINATIONS } from "./destinations/all.ts";
import { SendError } from "./destinations/destination.ts";
import { keysId, type Outbox } from "./outbox.ts";
import type { TelegramLink } from "./telegram-link.ts";

export interface Delivery {
  outbox: Outbox;
  telegram: TelegramLink;
}

// What a paste should have been, in the words the Connect sheet uses.
const EXPECTED: Partial<Record<DestinationKind, string>> = {
  slack: "the link Slack shows under Incoming Webhooks",
  discord: "the link Discord gives you with Copy Webhook URL",
  telegram: "the key BotFather sends you",
  ntfy: "a channel name of letters, numbers, - and _",
};

// Only the keys its service takes, every one it needs, each shaped as its service gives it.
function keysFor(settings: DestinationSettings, keys: DestinationKeys): DestinationKeys {
  const { kind } = settings;
  const kept: DestinationKeys = {};
  for (const name of DESTINATIONS[kind].keys) {
    const key = name.replace(/\?$/, "");
    const value = keys[key];
    if (value === undefined) {
      if (!name.endsWith("?")) throw new RequestError(400, "invalid_request", `Paste its ${key}.`);
      continue;
    }
    if (!pasteFits(kind, key, value)) {
      const expected = EXPECTED[kind] ?? `its ${key}`;
      throw new RequestError(400, "invalid_request", `That doesn't look like ${expected}.`);
    }
    kept[key] = value.trim();
  }
  return kept;
}

// Its name is its password, so it is long and random and never typed.
const newTopic = () => `ot-${randomBytes(18).toString("base64url")}`;

function phoneChannel(server: string, topic: string): PhoneChannel {
  const url = new URL(server);
  const secure = url.protocol === "https:" ? "" : "&secure=false";
  return {
    topic,
    appLink: `ntfy://${url.host}${url.pathname.replace(/\/$/, "")}/${topic}?display=Office+Town${secure}`,
    webLink: `${server.replace(/\/$/, "")}/${topic}`,
  };
}

// A newly connected place starts ticked for a few alerts; a removed one leaves every list.
function withPlace(settings: Settings, id: string): Partial<Settings> {
  const routes = { ...settings.updateRoutes };
  for (const kind of NEW_PLACE_HEARS) routes[kind] = [...(routes[kind] ?? []), id];
  return { updateRoutes: routes };
}

function withoutPlace(settings: Settings, id: string): Partial<Settings> {
  const routes = Object.fromEntries(
    Object.entries(settings.updateRoutes ?? {}).map(([kind, ids]) => [
      kind,
      ids.filter((each) => each !== id),
    ]),
  );
  return {
    updateRoutes: routes,
    resultPlaces: (settings.resultPlaces ?? []).filter((each) => each !== id),
  };
}

const updatesOf = (settings: Settings): Updates => ({
  routes: settings.updateRoutes ?? {},
  resultPlaces: settings.resultPlaces ?? [],
});

const couldNot = (error: unknown) => {
  if (!(error instanceof SendError)) return error;
  return new RequestError(400, "invalid_request", `Couldn't send: ${error.message}.`);
};

// A place is connected once, by pasting what its service gives, or for a phone by nothing at all.
export function destinationRoutes(store: Store, { outbox, telegram }: Delivery): Route[] {
  const { destinations } = store;
  const found = (id: string) => {
    const destination = destinations.get(id);
    if (destination === undefined) throw new RecordNotFoundError("destination");
    return destination;
  };
  return [
    {
      method: "GET",
      path: "/destinations",
      reply: () => {
        const list: DestinationList = { destinations: destinations.list() };
        return { status: 200, json: list };
      },
    },
    {
      method: "POST",
      path: "/destinations",
      reply: async ({ body }) => {
        const { name, settings, keys = {} } = destinationRequestSchema.parse(await body());
        const topic = settings.kind === "ntfy" && keys.topic === undefined ? newTopic() : undefined;
        const kept = keysFor(settings, topic === undefined ? keys : { ...keys, topic });
        const created = destinations.create(name, settings);
        writeKeys(outbox.secrets, keysId(created.id), kept);
        store.saveSettings(withPlace(store.readSettings(), created.id));
        const answer: DestinationCreated = {
          ...created,
          ...(topic !== undefined && settings.kind === "ntfy"
            ? { phone: phoneChannel(settings.server, topic) }
            : {}),
        };
        return { status: 201, json: answer };
      },
    },
    {
      method: "PUT",
      path: "/destinations/:id",
      // A new bot key is another bot, so its chat is linked again.
      reply: async ({ param, body }) => {
        const before = found(param("id"));
        const { name, settings, keys } = destinationRequestSchema.parse(await body());
        if (settings.kind !== before.settings.kind) {
          throw new RequestError(400, "invalid_request", "A destination keeps its service.");
        }
        if (keys !== undefined) {
          const kept = keysFor(settings, { ...outbox.keysOf(before.id), ...keys });
          if (kept.token !== outbox.keysOf(before.id).token) {
            telegram.forget(before.id);
            destinations.setLink(before.id, undefined);
          }
          writeKeys(outbox.secrets, keysId(before.id), kept);
        }
        const updated = destinations.update(before.id, name, settings);
        return { status: 200, json: updated };
      },
    },
    {
      method: "DELETE",
      path: "/destinations/:id",
      reply: ({ param }) => {
        const { id } = found(param("id"));
        telegram.forget(id);
        destinations.remove(id);
        outbox.secrets.remove(keysId(id));
        store.saveSettings(withoutPlace(store.readSettings(), id));
        return { status: 204 };
      },
    },
    {
      method: "PUT",
      path: "/updates",
      // A kind left out keeps its places; every place named must be connected.
      reply: async ({ body }) => {
        const change = updatesRequestSchema.parse(await body());
        const named = [
          ...Object.values(change.routes ?? {}).flat(),
          ...(change.resultPlaces ?? []),
        ];
        for (const id of named) found(id);
        const settings = store.readSettings();
        store.saveSettings({
          ...(change.routes === undefined
            ? {}
            : { updateRoutes: { ...settings.updateRoutes, ...change.routes } }),
          ...(change.resultPlaces === undefined ? {} : { resultPlaces: change.resultPlaces }),
        });
        return { status: 200, json: updatesOf(store.readSettings()) };
      },
    },
    {
      method: "POST",
      path: "/destinations/:id/test",
      reply: async ({ param }) => {
        await outbox.test(found(param("id"))).catch((error: unknown) => {
          throw couldNot(error);
        });
        return { status: 204 };
      },
    },
    {
      method: "POST",
      path: "/destinations/:id/link",
      reply: async ({ param }) => {
        const destination = found(param("id"));
        if (destination.settings.kind !== "telegram") {
          throw new RequestError(400, "invalid_request", "Only Telegram links a chat.");
        }
        const code = await telegram.linkCode(destination).catch((error: unknown) => {
          throw couldNot(error);
        });
        return { status: 200, json: code };
      },
    },
    {
      method: "DELETE",
      path: "/destinations/:id/link",
      reply: ({ param }) => ({
        status: 200,
        json: destinations.setLink(found(param("id")).id, undefined),
      }),
    },
  ];
}
