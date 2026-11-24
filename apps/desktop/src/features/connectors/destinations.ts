import type { DestinationKind, DestinationRecord } from "@office-town/contract";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { onChange } from "../../store/live.ts";

// Read once, then kept by the live changes.
export function useDestinations(): DestinationRecord[] | undefined {
  const [destinations, setDestinations] = useState<DestinationRecord[]>();
  useEffect(() => {
    let current = true;
    api
      .listDestinations()
      .then((list) => current && setDestinations(list))
      .catch((failure: unknown) => console.error("Could not read the destinations.", failure));
    const stop = onChange((change) => {
      if (change.type === "destination") {
        const { destination } = change;
        setDestinations((list) =>
          list?.some((one) => one.id === destination.id)
            ? list.map((one) => (one.id === destination.id ? destination : one))
            : [...(list ?? []), destination],
        );
      }
      if (change.type === "destination.removed") {
        setDestinations((list) => list?.filter((one) => one.id !== change.destinationId));
      }
    });
    return () => {
      current = false;
      stop();
    };
  }, []);
  return destinations;
}

export interface KeyField {
  key: string;
  label: string;
  secret: boolean;
  optional?: true;
}

// What each service is for, what it asks for and where to find it. Settings fields carry no secret.
export const SERVICES: Record<
  DestinationKind,
  { label: string; description: string; hint: string; keys: KeyField[]; settings?: KeyField[] }
> = {
  telegram: {
    label: "Telegram",
    description: "Results and alerts in a chat with your own bot",
    hint: "In Telegram, message @BotFather, send /newbot, and paste the key it gives you.",
    keys: [{ key: "token", label: "Bot key", secret: true }],
  },
  slack: {
    label: "Slack",
    description: "Results and alerts in a channel, through a webhook",
    hint: "In Slack, make an app with Incoming Webhooks on and add one to a channel.",
    keys: [{ key: "url", label: "Webhook address", secret: true }],
  },
  discord: {
    label: "Discord",
    description: "Results and alerts in a channel, through a webhook",
    hint: "In a channel's settings, open Integrations, then Webhooks, and copy one's address.",
    keys: [{ key: "url", label: "Webhook address", secret: true }],
  },
  ntfy: {
    label: "ntfy",
    description: "Results and alerts as notifications on your phone",
    hint: "Anyone who knows the topic can read it, so pick one that's hard to guess.",
    keys: [
      { key: "topic", label: "Topic", secret: true },
      { key: "token", label: "Access token", secret: true, optional: true },
    ],
    settings: [{ key: "server", label: "Server", secret: false }],
  },
  email: {
    label: "Email",
    description: "Results and alerts by email, through Resend",
    hint: "Sent through Resend. Without your own domain there, it only sends to your Resend account's address.",
    keys: [{ key: "key", label: "Resend key", secret: true }],
    settings: [
      { key: "to", label: "Send to", secret: false },
      { key: "from", label: "From", secret: false, optional: true },
    ],
  },
  webhook: {
    label: "Webhook",
    description: "Results and alerts as JSON, to an address you run",
    hint: "Each message is posted as JSON, for n8n, Home Assistant or your own script.",
    keys: [{ key: "url", label: "Address", secret: true }],
  },
};

export const serviceLabel = (destination: DestinationRecord) =>
  SERVICES[destination.settings.kind].label;
