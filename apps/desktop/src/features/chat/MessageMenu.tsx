import { Copy, Link, TextSelect } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { ContextMenu, copyText, type MenuAction, type MenuContent } from "../../ui/ActionMenu.tsx";

// Text selected inside this message only, so a selection elsewhere on the page is not offered.
function selectionIn(area: Element): string {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return "";
  const range = selection.getRangeAt(0);
  if (!area.contains(range.commonAncestorContainer)) return "";
  return selection.toString().trim();
}

// Copies what was written, in Markdown, so lists, links and code paste as they were. The menu
// covers the whole message, so it also copies the link or selection under the pointer.
function messageMenu(text: string, click: MouseEvent<HTMLElement>): MenuContent {
  const actions: MenuAction[] = [];
  const selected = selectionIn(click.currentTarget);
  if (selected !== "") {
    actions.push({ label: "Copy selection", icon: TextSelect, run: () => copyText(selected) });
  }
  const link = click.target instanceof Element ? click.target.closest("a[href]") : null;
  if (link instanceof HTMLAnchorElement) {
    const href = link.href;
    actions.push({ label: "Copy link", icon: Link, run: () => copyText(href) });
  }
  actions.push({ label: "Copy message", icon: Copy, run: () => copyText(text) });
  return { actions };
}

// The child must be an element, such as the message's own box.
export function MessageMenu({ text, children }: { text: string; children: ReactElement }) {
  return <ContextMenu menu={(click) => messageMenu(text, click)}>{children}</ContextMenu>;
}
