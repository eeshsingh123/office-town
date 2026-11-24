import { z } from "zod";

// Where an automation's results and alerts go out (D-130). Each kind is one file in the core.
export const destinationKindSchema = z.enum(["telegram", "slack", "discord", "email", "webhook"]);
export type DestinationKind = z.infer<typeof destinationKindSchema>;

// What is not secret, by kind. The key, token or address is pasted apart and kept only in the
// computer's credential store, never in the database (D-67).
export const destinationSettingsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("telegram") }),
  z.object({ kind: z.literal("slack") }),
  z.object({ kind: z.literal("discord") }),
  z.object({
    kind: z.literal("email"),
    to: z.email(),
    // Without a domain of its own, Resend only sends to the account's own address.
    from: z.email().optional(),
  }),
  z.object({ kind: z.literal("webhook") }),
]);
export type DestinationSettings = z.infer<typeof destinationSettingsSchema>;

// The secret parts, by name: Telegram's bot key, a Slack or Discord webhook address, a Resend key,
// a webhook address.
export const destinationKeysSchema = z.record(z.string(), z.string().trim().min(1).max(2_000));
export type DestinationKeys = z.infer<typeof destinationKeysSchema>;

export const destinationRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  settings: destinationSettingsSchema,
  // Required when adding; when editing, left out keeps the saved ones.
  keys: destinationKeysSchema.optional(),
});
export type DestinationRequest = z.input<typeof destinationRequestSchema>;

// The one Telegram chat and person whose replies are taken, linked with a one-time code (D-130).
export const telegramLinkSchema = z.object({
  chatId: z.number().int(),
  userId: z.number().int(),
  // As Telegram showed them when linked.
  name: z.string().min(1),
  linkedAt: z.iso.datetime(),
});
export type TelegramLink = z.infer<typeof telegramLinkSchema>;

export const destinationRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  settings: destinationSettingsSchema,
  // The last send or test that failed, in plain words; cleared by the next one that works.
  problem: z.string().min(1).optional(),
  link: telegramLinkSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DestinationRecord = z.infer<typeof destinationRecordSchema>;

export const destinationListSchema = z.object({ destinations: z.array(destinationRecordSchema) });
export type DestinationList = z.infer<typeof destinationListSchema>;

// The code to send the bot, and the link that sends it for you.
export const telegramCodeSchema = z.object({
  code: z.string().min(1),
  url: z.url().optional(),
  expiresAt: z.iso.datetime(),
});
export type TelegramCode = z.infer<typeof telegramCodeSchema>;

// What a paste must look like, by service and key. The Connect sheet explains a wrong one as it is
// pasted, and the core refuses the same, so the two never disagree.
export const PASTE_PATTERNS: Partial<Record<DestinationKind, Record<string, RegExp>>> = {
  slack: { url: /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/ },
  discord: {
    url: /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/,
  },
  telegram: { token: /^\d+:[A-Za-z0-9_-]{30,}$/ },
};

export function pasteFits(kind: DestinationKind, key: string, value: string): boolean {
  return PASTE_PATTERNS[kind]?.[key]?.test(value.trim()) ?? true;
}

// Where a task's or a run's result went, by the places' names when it was sent.
export const deliverySchema = z.object({
  sentTo: z.array(z.string().min(1)),
  // The last send that failed, in plain words: "Couldn't send to Slack: the link was removed."
  problem: z.string().min(1).optional(),
});
export type Delivery = z.infer<typeof deliverySchema>;
