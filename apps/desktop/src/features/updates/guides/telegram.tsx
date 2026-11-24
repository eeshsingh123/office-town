import type { ServiceGuide } from "./guide.ts";
import { Screen } from "./picture.tsx";

// Checked 2026-11-24 against Telegram's bot tutorial.
export const telegram: ServiceGuide = {
  kind: "telegram",
  label: "Telegram",
  logo: "telegram",
  steps: [
    {
      text: "Open BotFather in Telegram and send /newbot.",
      open: { label: "Open BotFather", url: "https://t.me/BotFather" },
    },
    { text: "Pick a name, then a username that ends in bot." },
    {
      text: "Copy the key BotFather sends and paste it below.",
      picture: {
        draw: () => <Screen title="BotFather" line="Use this token: 123456:AAH…" press="Copy" />,
        alt: "BotFather's message with the bot's key",
      },
    },
  ],
  fields: [
    {
      key: "token",
      label: "The key BotFather sent",
      wrong: (value) =>
        value.startsWith("@") || /^https?:/.test(value)
          ? { say: "That's the bot's name or link. Paste the key BotFather sent.", step: 2 }
          : { say: "That isn't a bot key. It looks like 123456:AAH… with no spaces.", step: 2 },
    },
  ],
};
