import type { KeyboardEvent, PointerEvent } from "react";
import type { PaneSize } from "./pane.ts";
import styles from "./ResizeHandle.module.css";

interface ResizeHandleProps {
  label: string;
  width: number;
  size: PaneSize;
  // The pane's edge the handle sits on; dragging away from the pane makes it wider.
  edge: "left" | "right";
  onResize: (width: number) => void;
  onDragging?: (dragging: boolean) => void;
}

const STEP = 16;

export function ResizeHandle({
  label,
  width,
  size,
  edge,
  onResize,
  onDragging,
}: ResizeHandleProps) {
  const direction = edge === "right" ? 1 : -1;
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    onDragging?.(true);
    const move = (moved: globalThis.PointerEvent) =>
      onResize(startWidth + (moved.clientX - startX) * direction);
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onDragging?.(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const wider = edge === "right" ? "ArrowRight" : "ArrowLeft";
    const narrower = edge === "right" ? "ArrowLeft" : "ArrowRight";
    if (event.key === wider) onResize(width + STEP);
    else if (event.key === narrower) onResize(width - STEP);
    else return;
    event.preventDefault();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a splitter
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className={`${styles.handle} ${edge === "right" ? styles.right : styles.left}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(size.initial)}
    />
  );
}
