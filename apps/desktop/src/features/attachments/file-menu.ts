import { OPENS_SAFELY } from "@office-town/contract";
import { Copy, FolderOpen, SquareArrowOutUpRight } from "lucide-react";
import { shell } from "../../shell.ts";
import { copyText, type MenuAction, type MenuContent } from "../../ui/ActionMenu.tsx";
import { extensionOf } from "../outputs/kinds.ts";

// A file or folder on the user's disk. Open only for kinds that cannot run (as in Outputs);
// browser mode has no shell, so only the path can be copied there.
export function fileMenu(path: string, kind: "file" | "image" | "folder"): MenuContent {
  const actions: MenuAction[] = [];
  if (shell !== undefined) {
    const bridge = shell;
    if (kind === "folder") {
      actions.push({
        label: "Open",
        icon: SquareArrowOutUpRight,
        run: () => bridge.openFolder(path),
      });
    } else {
      if (OPENS_SAFELY.has(extensionOf(path))) {
        actions.push({
          label: "Open",
          icon: SquareArrowOutUpRight,
          run: () => bridge.openFile(path),
        });
      }
      actions.push({ label: "Show in folder", icon: FolderOpen, run: () => bridge.showFile(path) });
    }
  }
  actions.push({ label: "Copy path", icon: Copy, run: () => copyText(path) });
  return { actions };
}
