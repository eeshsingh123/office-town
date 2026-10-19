import { Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import styles from "./PointsField.module.css";
import { pointsOf, textOf } from "./points.ts";

interface Point {
  key: number;
  text: string;
}

interface PointsFieldProps {
  value: string;
  onChange: (value: string) => void;
  // Names the list and its rows for screen readers, e.g. "Team rules".
  label: string;
  placeholder: string;
  addLabel: string;
}

let lastKey = 0;
const pointOf = (text: string): Point => {
  lastKey += 1;
  return { key: lastKey, text };
};
const listOf = (value: string): Point[] => {
  const points = pointsOf(value).map(pointOf);
  return points.length === 0 ? [pointOf("")] : points;
};

// Text kept as one point per line, edited as a list: Enter starts a new point, Backspace at the
// start of one joins it to the one above. The list is split only when the text changes from outside,
// so typing never reflows it.
export function PointsField({ value, onChange, label, placeholder, addLabel }: PointsFieldProps) {
  const [points, setPoints] = useState(() => listOf(value));
  const sent = useRef(value);
  const boxes = useRef(new Map<number, HTMLTextAreaElement>());
  const focusNext = useRef<{ key: number; at: number }>(undefined);

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setPoints(listOf(value));
  }, [value]);

  useEffect(() => {
    const next = focusNext.current;
    if (next === undefined) return;
    focusNext.current = undefined;
    const box = boxes.current.get(next.key);
    box?.focus();
    box?.setSelectionRange(next.at, next.at);
  });

  const commit = (next: Point[], focus?: { key: number; at: number }) => {
    focusNext.current = focus;
    setPoints(next);
    sent.current = textOf(next.map((point) => point.text));
    onChange(sent.current);
  };

  const edit = (index: number, text: string) => {
    // A pasted list becomes one point per line.
    const lines = text.split(/\r?\n/);
    const added = lines.slice(1).map(pointOf);
    const next = points.toSpliced(
      index,
      1,
      { ...points[index], text: lines[0] ?? "" } as Point,
      ...added,
    );
    commit(
      next,
      added.length === 0
        ? undefined
        : { key: added.at(-1)?.key ?? 0, at: lines.at(-1)?.length ?? 0 },
    );
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLTextAreaElement>) => {
    const point = points[index];
    if (point === undefined) return;
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const after = pointOf(point.text.slice(selectionEnd));
      const next = points.toSpliced(
        index,
        1,
        { ...point, text: point.text.slice(0, selectionStart) },
        after,
      );
      commit(next, { key: after.key, at: 0 });
      return;
    }
    const above = points[index - 1];
    if (event.key === "Backspace" && selectionStart === 0 && selectionEnd === 0 && above) {
      event.preventDefault();
      const joined = { ...above, text: above.text + point.text };
      commit(points.toSpliced(index - 1, 2, joined), { key: above.key, at: above.text.length });
    }
  };

  const remove = (index: number) => {
    const next = points.toSpliced(index, 1);
    const neighbour = next[Math.max(0, index - 1)];
    if (next.length === 0 || neighbour === undefined) {
      const empty = pointOf("");
      commit([empty], { key: empty.key, at: 0 });
    } else {
      commit(next, { key: neighbour.key, at: neighbour.text.length });
    }
  };

  const add = () => {
    const last = points.at(-1);
    if (last !== undefined && last.text.trim() === "") {
      focusNext.current = { key: last.key, at: 0 };
      setPoints([...points]);
      return;
    }
    const empty = pointOf("");
    commit([...points, empty], { key: empty.key, at: 0 });
  };

  return (
    <div className={styles.box}>
      <ol className={styles.list} aria-label={label}>
        {points.map((point, index) => (
          <li key={point.key} className={styles.point}>
            <span className={styles.marker} aria-hidden />
            <textarea
              ref={(box) => {
                if (box === null) boxes.current.delete(point.key);
                else boxes.current.set(point.key, box);
              }}
              className={styles.text}
              rows={1}
              value={point.text}
              aria-label={`${label}, point ${index + 1} of ${points.length}`}
              placeholder={index === 0 && points.length === 1 ? placeholder : ""}
              onChange={(event) => edit(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
            />
            {points.length === 1 && point.text === "" ? null : (
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove point ${index + 1}`}
                title="Remove"
                onClick={() => remove(index)}
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className={styles.add} onClick={add}>
        <Plus size={13} aria-hidden />
        {addLabel}
      </button>
    </div>
  );
}
