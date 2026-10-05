import { Tooltip } from "radix-ui";
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Agent } from "../../store/agents.ts";
import type { AgentState } from "../../trace/progress.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { Character } from "./Character.tsx";
import {
  clampToRoom,
  DESK,
  type FloorPlan,
  inRect,
  type Point,
  REACH,
  rectFrom,
  withinReach,
} from "./floor-plan.ts";
import styles from "./Office.module.css";

export interface FloorAgent {
  agent: Agent;
  state: AgentState;
  position: Point;
  harness: string;
  // What the agent is doing, shown above its head while it works or waits.
  bubble?: string;
}

interface FloorProps {
  plan: FloorPlan;
  agents: FloorAgent[];
  selection: string[];
  onSelect: (agentIds: string[]) => void;
}

const SPEED = 260;
const DIRECTIONS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};
// A press shorter than this is a click on the floor, not a drag.
const DRAG_THRESHOLD = 6;
const FINISHED: AgentState[] = ["idle", "done", "failed", "stopped", "interrupted"];

// Holding a direction key walks the player once per frame until every key is released.
function useWalking(plan: FloorPlan) {
  const [player, setPlayer] = useState(plan.start);
  const held = useRef(new Set<string>());
  const frame = useRef<number | undefined>(undefined);
  const last = useRef(0);

  const tick = useCallback(
    (time: number) => {
      const seconds = Math.min(0.05, (time - last.current) / 1000);
      last.current = time;
      let x = 0;
      let y = 0;
      for (const key of held.current) {
        x += DIRECTIONS[key]?.x ?? 0;
        y += DIRECTIONS[key]?.y ?? 0;
      }
      const length = Math.hypot(x, y);
      if (length === 0) {
        frame.current = undefined;
        return;
      }
      setPlayer((at) =>
        clampToRoom(
          { x: at.x + (x / length) * SPEED * seconds, y: at.y + (y / length) * SPEED * seconds },
          plan,
        ),
      );
      frame.current = requestAnimationFrame(tick);
    },
    [plan],
  );

  const press = (key: string) => {
    held.current.add(key);
    if (frame.current !== undefined) return;
    last.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  };
  const release = (key?: string) => {
    if (key === undefined) held.current.clear();
    else held.current.delete(key);
  };
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return { player, press, release };
}

export function Floor({ plan, agents, selection, onSelect }: FloorProps) {
  const { player, press, release } = useWalking(plan);
  const floor = useRef<HTMLDivElement>(null);
  const you = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: Point; to: Point }>();
  const near = withinReach(player, agents);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the player as it walks
  useEffect(() => {
    if (player === plan.start) return;
    you.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [player]);

  const pointOf = (event: PointerEvent): Point => {
    const bounds = floor.current?.getBoundingClientRect();
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key in DIRECTIONS) {
      event.preventDefault();
      press(key);
    } else if (key === "e" && near !== undefined) {
      onSelect([near.agent.id]);
    } else if (key === "Escape") {
      onSelect([]);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button") !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    const at = pointOf(event);
    setDrag({ from: at, to: at });
  };
  const onPointerMove = (event: PointerEvent) => {
    if (drag !== undefined) setDrag({ ...drag, to: pointOf(event) });
  };
  const onPointerUp = () => {
    if (drag === undefined) return;
    const box = rectFrom(drag.from, drag.to);
    setDrag(undefined);
    const dragged = box.width > DRAG_THRESHOLD || box.height > DRAG_THRESHOLD;
    onSelect(dragged ? inRect(box, agents).map(({ agent }) => agent.id) : []);
  };

  const box = drag === undefined ? undefined : rectFrom(drag.from, drag.to);
  return (
    <div
      ref={floor}
      className={styles.floor}
      style={{ width: plan.width, height: plan.height }}
      role="application"
      aria-roledescription="office floor"
      aria-label="Office floor. Walk with the arrow keys or WASD and press E to talk to the agent beside you. Tab moves between agents."
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the floor takes the walking keys
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => release(event.key.length === 1 ? event.key.toLowerCase() : event.key)}
      onBlur={() => release()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className={styles.room}
        style={{
          left: plan.room.x,
          top: plan.room.y,
          width: plan.room.width,
          height: plan.room.height,
        }}
      >
        <span className={styles.roomLabel}>
          Open floor<span>every agent at work gets a desk</span>
        </span>
      </div>
      <div
        className={styles.door}
        style={{ left: plan.door.x, top: plan.door.y, width: plan.door.width }}
      />
      {plan.seats.map(({ desk }) => (
        <div
          key={`${desk.x},${desk.y}`}
          className={styles.desk}
          style={{ left: desk.x, top: desk.y, width: DESK.width, height: DESK.height }}
        />
      ))}

      {near === undefined ? null : (
        <div
          className={styles.reach}
          style={{
            left: near.position.x - REACH,
            top: near.position.y - REACH,
            width: REACH * 2,
            height: REACH * 2,
          }}
        />
      )}

      {/* Under the agents, so an agent the player stands on stays readable. */}
      <div
        ref={you}
        className={styles.you}
        style={{ left: player.x - 18, top: player.y - 18 }}
        aria-hidden
      >
        You
      </div>
      {agents.map(({ agent, state, position, harness, bubble }) => {
        const selected = selection.includes(agent.id);
        const finished = FINISHED.includes(state);
        return (
          <div key={agent.id}>
            {bubble === undefined ? null : (
              <div
                className={`${styles.bubble} ${state === "waiting" ? styles.bubbleWaiting : ""}`}
                style={{ left: position.x, top: position.y - 46 }}
              >
                {bubble}
              </div>
            )}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  className={`${styles.agent} ${finished ? styles.finished : ""}`}
                  style={{ left: position.x - 40, top: position.y - 18 }}
                  aria-pressed={selected}
                  aria-label={`${agent.name}, ${harness}, ${STATE_LABELS[state].toLowerCase()}`}
                  onClick={(event) => {
                    const adding = event.shiftKey || event.ctrlKey || event.metaKey;
                    if (!adding) onSelect([agent.id]);
                    else if (selected) onSelect(selection.filter((id) => id !== agent.id));
                    else onSelect([...selection, agent.id]);
                  }}
                >
                  <Character
                    name={agent.name}
                    colour={agent.colour}
                    state={state}
                    selected={selected}
                  />
                  <span className={styles.nameTag}>
                    {agent.name}
                    {finished ? ` · ${STATE_LABELS[state].toLowerCase()}` : ""}
                  </span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className={styles.tooltip} sideOffset={6}>
                  {harness}
                  {agent.latest.options.model === undefined
                    ? ""
                    : ` · ${agent.latest.options.model}`}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        );
      })}

      {near === undefined ? null : (
        <div className={styles.hint} style={{ left: player.x, top: player.y + 26 }} aria-hidden>
          <Kbd>E</Kbd>Talk to {near.agent.name}
        </div>
      )}
      {box === undefined ? null : (
        <div
          className={styles.lasso}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
    </div>
  );
}
