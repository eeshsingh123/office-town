import type { Notice } from "@office-town/contract";
import { shell } from "../../shell.ts";
import { navigate } from "../../store/app-store.ts";
import { onChange } from "../../store/live.ts";

function show({ id, title, body, taskId }: Notice): void {
  const notification = new Notification(title, { body, tag: id });
  notification.onclick = () => {
    void shell?.showWindow();
    window.focus();
    if (taskId !== undefined) navigate({ name: "task", taskId });
  };
}

// The core decides what deserves an alert (D-124); the window shows it only while it is not in
// front, and the app itself shows the work behind each one.
export function showNotices(): void {
  onChange((change) => {
    if (change.type !== "notice.created") return;
    if (document.hasFocus() || typeof Notification === "undefined") return;
    if (Notification.permission === "default") void Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    show(change.notice);
  });
}
