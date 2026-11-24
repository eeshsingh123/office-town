import { Webhook } from "lucide-react";
import type { ServiceGuide } from "./guide.ts";

export const webhook: ServiceGuide = {
  kind: "webhook",
  label: "Webhook",
  logo: Webhook,
  more: true,
  steps: [],
  hint: "Each update is posted as JSON, for n8n, Home Assistant or your own script.",
  fields: [{ key: "url", label: "Address" }],
};
