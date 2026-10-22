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

// The saved picture, the image itself, or the kind's icon; `large` fills its card's width.
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
  const { target } = output;
  const source =
    output.picturedAt !== undefined
      ? pictureAddress(output)
      : kind === "image" && target.kind === "file"
        ? fileAddress(output.taskId, { path: target.path })
        : undefined;
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
