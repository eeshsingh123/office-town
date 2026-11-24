import type { DestinationKind } from "@office-town/contract";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export interface GuideStep {
  // Under 15 words, in the service's own button names.
  text: string;
  // Opens the exact page where the step happens.
  open?: { label: string; url: string };
  picture?: { draw: ComponentType; alt: string };
}

export interface PasteField {
  key: string;
  label: string;
  // Not secret: kept in settings, such as an email address.
  plain?: true;
  optional?: true;
  // What a wrong paste looks like, in one sentence, and the step that shows the right one.
  wrong?: (value: string) => { say: string; step: number } | undefined;
}

// What one service needs to connect: one file each, so a new service is a new file.
export interface ServiceGuide {
  kind: DestinationKind;
  label: string;
  // A logo in connectors/logos, or an icon for a way that has none.
  logo: string | LucideIcon;
  // Folded under "More ways", for technical users.
  more?: true;
  steps: GuideStep[];
  // One short hint, only where it helps.
  hint?: string;
  fields: PasteField[];
}
