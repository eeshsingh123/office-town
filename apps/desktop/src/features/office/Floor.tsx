import { FileText, GripVertical } from "lucide-react";
import { Tooltip } from "radix-ui";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Agent } from "../../store/agents.ts";
import { focusAgent, useApp } from "../../store/app-store.ts";
import type { AgentState } from "../../trace/progress.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { Character } from "./Character.tsx";
import { DoorChips } from "./DoorChips.tsx";
import type { DoorChip } from "./doors.ts";
import { FocusCard } from "./FocusCard.tsx";
import {
  clampToFloor,
  contains,
  DESK,
  type FloorPlan,
  inRect,
  movable,
  type Point,
  REACH,
  type Room,
  rectFrom,
  roomAt,
  withinReach,
} from "./floor-plan.ts";
import styles from "./Office.module.css";
import { type DrawnLink, type Link, type LinkState, linkPaths } from "./plan-links.ts";
import { type RoomMove, useRoomDrag } from "./use-room-drag.ts";
import { keysOwnedAt, typingIn } from "./waiting-keys.ts";

export interface FloorAgent {
  agent: Agent;
  state: AgentState;
  position: Point;
  harness: string;
  // Shown above its head while it works or waits.
  bubble?: string;
  // By name, to group a selection.
  group: string;
}

export interface RoomSign {
  title: string;
  note: string;
  lines: string[];
}

interface Seated {
  id: string;
  name: string;
  colour: string;
  // None for a chief that has not worked yet.
  state?: AgentState;
  position: Point;
  bubble?: string;
  // The session whose request the floor opens when it pans to this agent.
  sessionId?: string;
  detail: string;
}

interface FloorProps {
  plan: FloorPlan;
  agents: FloorAgent[];
  // By room id.
  signs: Record<string, RoomSign>;
  // By room id, the chief's included.
  doors: Record<string, DoorChip[]>;
  links: Link[];
  linksGoal: string | undefined;
  // It keeps its desk even before its first goal.
  chief: { id: string; name: string; colour: string } | undefined;
  selection: string[];
  room: string | undefined;
  onSelect: (agentIds: string[]) => void;
  onOpenRoom: (departmentId: string) => void;
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
// A press shorter than this is a click, not a drag.
const DRAG_THRESHOLD = 6;
const FINISHED: AgentState[] = ["idle", "done", "failed", "stopped", "interrupted"];
const LINK_CLASSES: Record<LinkState, string | undefined> = {
  waiting: styles.linkWaiting,
  active: styles.linkActive,
  done: styles.linkDone,
  failed: styles.linkFailed,
};
const LEGEND: [LinkState, string][] = [
  ["waiting", "Waiting"],
  ["active", "Active"],
  ["done", "Done"],
  ["failed", "Failed"],
];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Walks once per frame until every key is released.
function useWalking(plan: FloorPlan) {
  // Until the user walks, the player stands at the plan's start, which moves clear of rooms as they load.
  const [walked, setWalked] = useState<Point>();
  const player = walked ?? plan.start;
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
      setWalked((at = plan.start) =>
        clampToFloor(
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

// Sends a document along a link once when it turns active; never for links seen when the app opens.
function useHandoffs(links: readonly DrawnLink[], goalId: string | undefined) {
  const seen = useRef<{ goalId: string | undefined; states: Map<string, LinkState> }>(undefined);
  const [tokens, setTokens] = useState<{ key: string; path: string }[]>([]);
  useEffect(() => {
    const before = seen.current?.goalId === goalId ? seen.current?.states : undefined;
    const states = new Map(links.map((link) => [`${link.from}>${link.to}`, link.state]));
    seen.current = { goalId, states };
    if (before === undefined || reducedMotion()) return;
    const started = links.filter(
      (link) => link.state === "active" && before.get(`${link.from}>${link.to}`) !== "active",
    );
    if (started.length === 0) return;
    const now = Date.now();
    setTokens((running) => [
      ...running,
      ...started.map((link) => ({ key: `${link.from}>${link.to}@${now}`, path: link.path })),
    ]);
  }, [links, goalId]);
  const done = (key: string) => setTokens((running) => running.filter((one) => one.key !== key));
  return { tokens, done };
}

// The moved room and its desks follow the move.
function movedRooms(rooms: readonly Room[], move: RoomMove | undefined): Room[] {
  if (move === undefined) return [...rooms];
  const dx = move.at.x - move.from.x;
  const dy = move.at.y - move.from.y;
  return rooms.map((room) =>
    room.id !== move.id
      ? room
      : {
          ...room,
          rect: { ...room.rect, x: room.rect.x + dx, y: room.rect.y + dy },
          seats: room.seats.map(({ desk, agent }) => ({
            desk: { x: desk.x + dx, y: desk.y + dy },
            agent: { x: agent.x + dx, y: agent.y + dy },
          })),
        },
  );
}

function seatedOf(
  agents: readonly FloorAgent[],
  chief: FloorProps["chief"],
  rooms: readonly Room[],
  move: RoomMove | undefined,
): Seated[] {
  const shift = (position: Point): Point =>
    move === undefined || !contains(move.from, position)
      ? position
      : { x: position.x + move.at.x - move.from.x, y: position.y + move.at.y - move.from.y };
  const seated = agents.map(({ agent, state, position, harness, bubble }) => ({
    id: agent.id,
    name: agent.name,
    colour: agent.colour,
    state,
    position: shift(position),
    sessionId: agent.latest.id,
    detail: `${harness}${agent.latest.options.model === undefined ? "" : ` · ${agent.latest.options.model}`}`,
    ...(bubble === undefined ? {} : { bubble }),
  }));
  const office = rooms.find((room) => room.kind === "chief")?.seats[0];
  if (chief === undefined || office === undefined || seated.some(({ id }) => id === chief.id)) {
    return seated;
  }
  return [...seated, { ...chief, position: office.agent, detail: "Chief" }];
}

// Small enough that names still read; below it the floor scrolls.
const MIN_SCALE = 0.6;

// The floor shrinks to fit its pane's width, never grows past full size.
function useFitScale(floor: RefObject<HTMLDivElement | null>, width: number) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const scroller = floor.current?.parentElement;
    if (scroller === undefined || scroller === null) return;
    const fit = () => {
      const ratio = Math.min(1, Math.max(MIN_SCALE, scroller.clientWidth / width));
      setScale(Math.floor(ratio * 100) / 100);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [floor, width]);
  return scale;
}

// Once per request to focus, smoothly unless motion is reduced.
function usePanTo(
  floor: RefObject<HTMLDivElement | null>,
  scale: number,
  at: Point | undefined,
  key = 0,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: pans once per focus, not as agents move
  useEffect(() => {
    const scroller = floor.current?.parentElement;
    if (at === undefined || scroller === undefined || scroller === null) return;
    const floorBox = floor.current?.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const left = (floorBox?.left ?? 0) - box.left + scroller.scrollLeft + at.x * scale;
    const top = (floorBox?.top ?? 0) - box.top + scroller.scrollTop + at.y * scale;
    scroller.scrollTo({
      left: left - scroller.clientWidth / 2,
      top: top - scroller.clientHeight / 2,
      behavior: reducedMotion() ? "instant" : "smooth",
    });
  }, [key, at === undefined]);
}

// WASD walks from anywhere on the page, taking the keyboard to the floor. Arrows only when nothing
// has focus, since lists, tabs and scroll areas use them. Typing, dialogs and menus keep their keys.
function useWalkFromAnywhere(
  floor: RefObject<HTMLDivElement | null>,
  press: (key: string) => void,
) {
  const latest = useRef(press);
  latest.current = press;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!(key in DIRECTIONS) || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      const element = floor.current;
      if (element === null || (target instanceof Node && element.contains(target))) return;
      if (key.startsWith("Arrow") && target !== document.body) return;
      if (typingIn(target) || keysOwnedAt(target)) return;
      event.preventDefault();
      element.focus({ preventScroll: true });
      latest.current(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [floor]);
}

export function Floor(props: FloorProps) {
  const { plan, agents, signs, doors, links, linksGoal, chief, selection, room } = props;
  const { onSelect, onOpenRoom } = props;
  const { player, press, release } = useWalking(plan);
  const floor = useRef<HTMLDivElement>(null);
  const you = useRef<HTMLDivElement>(null);
  useWalkFromAnywhere(floor, press);
  const [drag, setDrag] = useState<{ from: Point; to: Point }>();
  const scale = useFitScale(floor, plan.width);
  const { move, handlers, wasClick } = useRoomDrag(plan, scale);
  const rooms = useMemo(() => movedRooms(plan.rooms, move), [plan.rooms, move]);
  const seated = seatedOf(agents, chief, rooms, move);
  const drawn = useMemo(() => linkPaths(links, rooms), [links, rooms]);
  const { tokens, done } = useHandoffs(drawn, linksGoal);
  const near = withinReach(player, seated);
  // Walking into a room opens its panel.
  const inside = useRef<string | undefined>(undefined);

  const focus = useApp((state) => state.focus);
  // The agent's oldest waiting request, from any of its sessions, as `waitingOrder` finds it.
  const request = useApp((state) => {
    const agentId = state.focus?.agentId;
    if (agentId === undefined) return undefined;
    return Object.values(state.waiting)
      .filter(({ event }) => state.sessions[event.sessionId]?.agentId === agentId)
      .sort((a, b) => a.position - b.position)[0];
  });
  const focused = seated.find(({ id }) => id === focus?.agentId);
  usePanTo(floor, scale, focused?.position, focus?.at);
  const answered = focused !== undefined && request === undefined;
  useEffect(() => {
    if (answered) focusAgent(undefined);
  }, [answered]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the player as it walks
  useEffect(() => {
    if (player === plan.start) return;
    you.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const standingIn = roomAt(player, plan);
    const entered = standingIn?.kind === "department" ? standingIn.id : undefined;
    if (entered !== undefined && entered !== inside.current) onOpenRoom(entered);
    inside.current = entered;
  }, [player]);

  useEffect(() => {
    if (room === undefined) return;
    document
      .getElementById(`room-${room}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [room]);

  const pointOf = (event: PointerEvent): Point => {
    const bounds = floor.current?.getBoundingClientRect();
    return {
      x: (event.clientX - (bounds?.left ?? 0)) / scale,
      y: (event.clientY - (bounds?.top ?? 0)) / scale,
    };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key in DIRECTIONS) {
      event.preventDefault();
      press(key);
    } else if (key === "e" && near !== undefined) {
      onSelect([near.id]);
    } else if (key === "Escape") {
      onSelect([]);
      focusAgent(undefined);
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
    onSelect(dragged ? inRect(box, seated).map(({ id }) => id) : []);
  };

  const signLabel = (id: string, kind: Room["kind"]) => {
    const sign = signs[id];
    const chips = doors[id] ?? [];
    if (kind === "chief") {
      return (
        <>
          Chief
          <DoorChips chips={chips} />
        </>
      );
    }
    if (sign === undefined) return null;
    return (
      <>
        {sign.title}
        <span>{sign.note}</span>
        <DoorChips chips={chips} />
      </>
    );
  };

  const chiefSelected = chief !== undefined && selection.length === 1 && selection[0] === chief.id;
  const box = drag === undefined ? undefined : rectFrom(drag.from, drag.to);
  return (
    <div
      ref={floor}
      className={styles.floor}
      style={{ width: plan.width, height: plan.height, zoom: scale }}
      role="application"
      aria-roledescription="office floor"
      aria-label="Office floor. Walk with the arrow keys or WASD and press E to talk to the agent beside you. Tab moves between agents. Alt and an arrow key move a room whose sign has focus."
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the floor takes the walking keys
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => release(event.key.length === 1 ? event.key.toLowerCase() : event.key)}
      onBlur={() => release()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {drawn.length === 0 ? null : (
        <>
          <svg
            className={styles.links}
            width={plan.width}
            height={plan.height}
            aria-hidden
            focusable="false"
          >
            {drawn.map(({ from, to, state, path }) => (
              <path key={`${from}>${to}`} className={LINK_CLASSES[state]} d={path} />
            ))}
          </svg>
          <div className={styles.legend} aria-hidden>
            <strong>Plan links</strong>
            {LEGEND.map(([state, label]) => (
              <span key={state} className={styles.legendItem}>
                <svg viewBox="0 0 34 8" aria-hidden>
                  <path className={LINK_CLASSES[state]} d="M2 4h30" />
                </svg>
                {label}
              </span>
            ))}
          </div>
        </>
      )}
      {rooms.map(({ id, kind, rect }) => {
        const sign = signs[id];
        const label = signLabel(id, kind);
        const open = kind === "chief" ? chiefSelected : room === id;
        const lifted = move?.id === id && move.lifted;
        const classes = [
          styles.room,
          kind === "guest" ? styles.guestRoom : "",
          kind === "chief" ? styles.chiefRoom : "",
          open ? styles.roomOpen : "",
          lifted ? styles.roomLifted : "",
        ];
        return (
          <div
            key={id}
            id={`room-${id}`}
            className={classes.join(" ")}
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          >
            {movable(kind) ? (
              <button
                type="button"
                className={`${styles.sign} ${styles.signButton}`}
                aria-pressed={open}
                {...handlers(id, rect)}
                onClick={() => {
                  if (!wasClick()) return;
                  if (kind === "chief" && chief !== undefined) onSelect([chief.id]);
                  else onOpenRoom(id);
                }}
              >
                <GripVertical size={13} className={styles.grip} aria-hidden />
                {label}
              </button>
            ) : (
              <span className={styles.sign}>{label}</span>
            )}
            {sign === undefined || sign.lines.length === 0 ? null : (
              <div className={styles.roomLines}>
                {sign.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {rooms
        .flatMap((one) => one.seats)
        .map(({ desk }) => (
          <div
            key={`${desk.x},${desk.y}`}
            className={styles.desk}
            style={{ left: desk.x, top: desk.y, width: DESK.width, height: DESK.height }}
          />
        ))}
      {tokens.map(({ key, path }) => (
        <span
          key={key}
          className={styles.token}
          style={{ offsetPath: `path("${path}")` }}
          onAnimationEnd={() => done(key)}
          aria-hidden
        >
          <FileText size={10} />
        </span>
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
      {seated.map(({ id, name, colour, state, position, bubble, detail }) => {
        const selected = selection.includes(id);
        const finished = state !== undefined && FINISHED.includes(state);
        return (
          <div key={id}>
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
                  aria-label={`${name}, ${detail}${state === undefined ? "" : `, ${STATE_LABELS[state].toLowerCase()}`}`}
                  onClick={(event) => {
                    const adding = event.shiftKey || event.ctrlKey || event.metaKey;
                    if (!adding) onSelect([id]);
                    else if (selected) onSelect(selection.filter((one) => one !== id));
                    else onSelect([...selection, id]);
                  }}
                >
                  <Character
                    name={name}
                    colour={colour}
                    state={state}
                    selected={selected}
                    square={id === chief?.id}
                    focused={id === focused?.id && request !== undefined}
                  />
                  <span className={styles.nameTag}>
                    {name}
                    {finished ? ` · ${STATE_LABELS[state].toLowerCase()}` : ""}
                  </span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className={styles.tooltip} sideOffset={6}>
                  {detail}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        );
      })}

      {near === undefined ? null : (
        <div className={styles.hint} style={{ left: player.x, top: player.y + 26 }} aria-hidden>
          <Kbd>E</Kbd>Talk to {near.name}
        </div>
      )}
      {box === undefined ? null : (
        <div
          className={styles.lasso}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
      {focused === undefined || request === undefined ? null : (
        <FocusCard
          key={request.event.id}
          request={request}
          at={focused.position}
          floorWidth={plan.width}
          onClosed={() => floor.current?.focus({ preventScroll: true })}
        />
      )}
    </div>
  );
}
