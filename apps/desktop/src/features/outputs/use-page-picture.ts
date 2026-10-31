import type { OutputRecord } from "@office-town/contract";
import { useEffect } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { viewKindOf } from "./kinds.ts";

export const PICTURE_WIDTH = 480;

export const toBlob = (png: Uint8Array) => new Blob([png as BlobPart], { type: "image/png" });

export const pictureIsCurrent = ({ picturedAt, updatedAt }: OutputRecord) =>
  picturedAt !== undefined && picturedAt >= updatedAt;

// Each version once per launch: a stopped site must not be tried at every look.
const asked = new Set<string>();

async function takePicture(output: OutputRecord): Promise<void> {
  const { target, taskId } = output;
  const { url } =
    target.kind === "site" ? target : await api.preview(taskId, { path: target.path });
  const png = await shell?.pictureOfPage(url, PICTURE_WIDTH);
  if (png !== undefined) await api.savePicture(output.id, toBlob(png));
}

// A card shows the page as soon as it appears, with no need to open it first.
export function usePagePicture(output: OutputRecord): void {
  useEffect(() => {
    const kind = viewKindOf(output.target);
    const version = `${output.id}:${output.updatedAt}`;
    if (shell === undefined || (kind !== "page" && kind !== "site")) return;
    if (pictureIsCurrent(output) || asked.has(version)) return;
    asked.add(version);
    takePicture(output).catch(() => {
      // The card keeps the kind's icon, and opening the page takes the picture.
    });
  }, [output]);
}
