import type { OutputRecord } from "@office-town/contract";
import {
  Code,
  File,
  FileText,
  Globe,
  Image as ImageIcon,
  LayoutTemplate,
  type LucideIcon,
  Sheet,
} from "lucide-react";
import { fileAddress, pictureAddress } from "../../api/client.ts";
import { type ViewKind, viewKindOf } from "./kinds.ts";
import styles from "./Outputs.module.css";

const ICONS: Record<ViewKind, LucideIcon> = {
  page: LayoutTemplate,
  site: Globe,
  image: ImageIcon,
  pdf: FileText,
  markdown: FileText,
  table: Sheet,
  code: Code,
  other: File,
};

export function KindIcon({ kind, size = 18 }: { kind: ViewKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} aria-hidden />;
}

// The saved picture, or the image itself; other kinds have none until a picture is taken.
export function pictureSource(output: OutputRecord): string | undefined {
  const { target } = output;
  if (output.picturedAt !== undefined) return pictureAddress(output);
  if (viewKindOf(target) !== "image" || target.kind !== "file") return undefined;
  return `${fileAddress(output.taskId, { path: target.path })}&at=${encodeURIComponent(output.updatedAt)}`;
}

// The picture or the kind's icon; `large` fills its card's width.
export function Picture({
  output,
  large = false,
  live = false,
}: {
  output: OutputRecord;
  large?: boolean;
  // A site that answers.
  live?: boolean;
}) {
  const kind = viewKindOf(output.target);
  const source = pictureSource(output);
  return (
    <span className={`${styles.picture} ${large ? styles.pictureLarge : ""}`}>
      {source === undefined ? (
        <KindIcon kind={kind} size={large ? 28 : 18} />
      ) : (
        <img src={source} alt="" loading="lazy" decoding="async" />
      )}
      {live ? <span className={styles.liveDot} aria-hidden /> : null}
    </span>
  );
}
