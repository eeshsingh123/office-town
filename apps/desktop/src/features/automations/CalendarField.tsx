import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import menu from "../../ui/Menu.module.css";
import styles from "./NewAutomation.module.css";
import { dayText } from "./words.ts";

const pad = (value: number) => String(value).padStart(2, "0");
export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const today = () => isoDay(new Date());

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// A date picked from a month grid, as a chip; days before `from` cannot be picked.
export function CalendarField({
  label,
  value,
  from = today(),
  onChange,
}: {
  label: string;
  value: string;
  from?: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = new Date(`${value}T12:00:00`);
  const [month, setMonth] = useState(() => new Date(picked.getFullYear(), picked.getMonth(), 1));
  const first = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: first }, () => undefined),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];
  const shift = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={styles.inline} aria-label={`${label}: ${dayText(value)}`}>
        <CalendarDays size={13} aria-hidden />
        {dayText(value)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${menu.surface} ${styles.calendar}`}
          align="start"
          sideOffset={6}
        >
          <div className={styles.calendarHead}>
            <button
              type="button"
              className={styles.calendarStep}
              aria-label="Month before"
              onClick={() => shift(-1)}
            >
              <ChevronLeft size={15} aria-hidden />
            </button>
            <span>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
            <button
              type="button"
              className={styles.calendarStep}
              aria-label="Month after"
              onClick={() => shift(1)}
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
          <div className={styles.calendarGrid}>
            {WEEK.map((day) => (
              <span key={day} className={styles.calendarDay} aria-hidden>
                {day}
              </span>
            ))}
            {cells.map((day, index) => {
              if (day === undefined) {
                // biome-ignore lint/suspicious/noArrayIndexKey: blank cells before the 1st never move
                return <span key={`blank-${index}`} />;
              }
              const date = isoDay(new Date(month.getFullYear(), month.getMonth(), day));
              return (
                <button
                  key={date}
                  type="button"
                  className={styles.calendarCell}
                  aria-pressed={date === value}
                  aria-label={dayText(date)}
                  disabled={date < from}
                  onClick={() => {
                    onChange(date);
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
