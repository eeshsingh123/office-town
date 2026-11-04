import { Copy, TextSelect } from "lucide-react";
import type { ReactElement } from "react";
import { ContextMenu, copyText, type MenuContent } from "../../ui/ActionMenu.tsx";

// Copies what was written, in Markdown, so lists, links and code paste as they were.
function messageMenu(text: string): MenuContent {
  const selected = window.getSelection()?.toString().trim() ?? "";
  return {
    actions: [
      { label: "Copy message", icon: Copy, run: () => copyText(text) },
      ...(selected === ""
        ? []
        : [{ label: "Copy selection", icon: TextSelect, run: () => copyText(selected) }]),
    ],
  };
}

// The child must be an element, such as the message's own box.
export function MessageMenu({ text, children }: { text: string; children: ReactElement }) {
  return <ContextMenu menu={() => messageMenu(text)}>{children}</ContextMenu>;
}
