import { Mail } from "lucide-react";
import type { ServiceGuide } from "./guide.ts";

export const email: ServiceGuide = {
  kind: "email",
  label: "Email",
  logo: Mail,
  more: true,
  steps: [
    {
      text: "Make an API key in Resend, the service that sends the mail.",
      open: { label: "Open Resend", url: "https://resend.com/api-keys" },
    },
    { text: "Paste the key below with the address to send to." },
  ],
  hint: "Without your own domain in Resend, mail only goes to your Resend account's address.",
  fields: [
    { key: "key", label: "Resend key" },
    { key: "to", label: "Send to", plain: true },
    { key: "from", label: "From", plain: true, optional: true },
  ],
};
