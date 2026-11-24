import {
  type DestinationKeys,
  type DestinationList,
  type DestinationSettings,
  destinationRequestSchema,
} from "@office-town/contract";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import { writeKeys } from "../connectors/secrets.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { DESTINATIONS } from "./destinations/all.ts";
import { SendError } from "./destinations/destination.ts";
import { keysId, type Outbox } from "./outbox.ts";
import type { TelegramReplies } from "./telegram-replies.ts";

export interface Delivery {
  outbox: Outbox;
  telegram: TelegramReplies;
}

// Only the keys its service takes, every one it needs.
function keysFor(settings: DestinationSettings, keys: DestinationKeys): DestinationKeys {
  const wanted = DESTINATIONS[settings.kind].keys;
  const kept: DestinationKeys = {};
  for (const name of wanted) {
    const key = name.replace(/\?$/, "");
    const value = keys[key];
    if (value !== undefined) kept[key] = value;
    else if (!name.endsWith("?"))
      throw new RequestError(400, "invalid_request", `Paste its ${key}.`);
  }
  return kept;
}

const couldNot = (error: unknown) => {
  if (!(error instanceof SendError)) return error;
  return new RequestError(400, "invalid_request", `Couldn't send: ${error.message}.`);
};

// Destinations are set up once, in Settings, by pasting a key, token or address (D-130).
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
        const { name, settings, keys } = destinationRequestSchema.parse(await body());
        const kept = keysFor(settings, keys ?? {});
        const created = destinations.create(name, settings);
        writeKeys(outbox.secrets, keysId(created.id), kept);
        telegram.follow(created);
        return { status: 201, json: created };
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
          if (kept.token !== outbox.keysOf(before.id).token)
            destinations.setLink(before.id, undefined);
          writeKeys(outbox.secrets, keysId(before.id), kept);
        }
        const updated = destinations.update(before.id, name, settings);
        telegram.follow(updated);
        return { status: 200, json: updated };
      },
    },
    {
      method: "DELETE",
      path: "/destinations/:id",
      reply: ({ param }) => {
        const { id } = found(param("id"));
        destinations.remove(id);
        outbox.secrets.remove(keysId(id));
        return { status: 204 };
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
