import type { ServiceGuide } from "./guide.ts";
import { Screen } from "./picture.tsx";

// Only what Slack's manifest reference lists: a name, and incoming webhooks on. Checked 2026-11-24.
const MANIFEST = {
  display_information: { name: "Office Town" },
  settings: { incoming_webhooks: { incoming_webhooks_enabled: true } },
};

const SETUP = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(MANIFEST))}`;

export const slack: ServiceGuide = {
  kind: "slack",
  label: "Slack",
  logo: "slack",
  steps: [
    {
      text: "Open Slack's setup page, pick your workspace and click Create.",
      open: { label: "Open Slack's setup page", url: SETUP },
    },
    { text: "Open Incoming Webhooks and click Add New Webhook." },
    { text: "Pick the channel for updates and allow it." },
    {
      text: "Copy the new link and paste it below.",
      picture: {
        draw: () => (
          <Screen title="Incoming Webhooks" line="hooks.slack.com/services/…" press="Copy" />
        ),
        alt: "Slack's Incoming Webhooks page, with Copy next to the link",
      },
    },
  ],
  hint: "Some workspaces need an admin to approve new apps.",
  fields: [
    {
      key: "url",
      label: "The link Slack gave you",
      wrong: (value) =>
        /slack\.com\/(archives|client)\//.test(value)
          ? { say: "That's a link to a channel. Paste the link from Incoming Webhooks.", step: 3 }
          : {
              say: "That isn't a webhook link. It starts with https://hooks.slack.com/services/.",
              step: 3,
            },
    },
  ],
};
