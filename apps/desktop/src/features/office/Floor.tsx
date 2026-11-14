import type { SessionOptions } from "@office-town/contract";
import { FileText, GripVertical, Plus } from "lucide-react";
import { Tooltip } from "radix-ui";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { lastCatalog } from "../../api/catalogs.ts";
import type { Agent } from "../../store/agents.ts";
import { focusAgent, navigate, useApp } from "../../store/app-store.ts";
import type { AgentState } from "../../trace/progress.ts";
import { ContextMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { compactCount } from "../../ui/format.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { departmentMenu } from "../departments/department-menu.tsx";
import { modelName } from "../profiles/model-name.ts";
import { fraction, metCount, type ShownStatus } from "../task/goal-progress.ts";
import { Segments } from "../task/Milestones.tsx";
import { useYou } from "../you/you.ts";
import { agentMenu } from "./agent-menu.tsx";
import { Character } from "./Character.tsx";
import { DoorChips } from "./DoorChips.tsx";
import type { DoorChip } from "./doors.ts";
import { FocusCard } from "./FocusCard.tsx";
import {
  ADD_CHIEF,
  clampToFloor,
  contains,
  DESK,
  type FloorPlan,
  inRect,
  movable,
  type Point,
  REACH,
  type Rect,
  type Room,
  rectFrom,
  roomAt,
  withinReach,
} from "./floor-plan.ts";
import styles from "./Office.module.css";
import { OPEN_FLOOR, type PanelKind, setPlayer, useOffice } from "./office-state.ts";
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
  // What it used on its department's current or last goal, shown above its head.
  tokens?: number;
  // By name, to group a selection.
  group: string;
  // Its part's milestones, or the goal's at the lead's desk (D-95).
  part?: ShownStatus[];
  // A department member with nothing to do: it sleeps at its desk. "today" keeps the badge of
  // what it finished today; "before" shows sleep only.
  free?: "today" | "before";
}

// A department member that has never worked: a desk, a name and its AI app.
export interface FreeMember {
  id: string;
  name: string;
  colour: string;
  position: Point;
  detail: string;
}

// From the agent's centre to the top of its token count, and to the top of its desk.
const TOKENS_ABOVE = 52;
const DESK_BELOW = 46;

export interface RoomSign {
  title: string;
  // Only the open floor and the review desk say what they hold; a department's name is enough.
  note?: string;
  lines: string[];
  // What the room's current or last goal used, in all and per AI app.
  usage?: { apps: { name: string; tokens: number }[]; total: number };
  // One segment per milestone of its goal, filling as each is met (D-95).
  progress?: { statuses: ShownStatus[]; label: string };
}

interface Seated {
  id: string;
  name: string;
  colour: string;
  // None for a chief that has not worked yet.
  state?: AgentState;
  position: Point;
  bubble?: string;
  tokens?: number;
  part?: ShownStatus[];
  // The session whose request the floor opens when it pans to this agent.
  sessionId?: string;
  detail: string;
  // Sleeping at its desk until work comes.
  asleep?: boolean;
}

interface FloorProps {
  plan: FloorPlan;
  agents: FloorAgent[];
  free: FreeMember[];
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
  // An agent's or the chief's id, or a department's.
  onOpenChat: (id: string, kind: PanelKind) => void;
}

// Screen pixels per second, the same at any floor scale.
const SPEED = 480;
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
  ["waiting", "Queued"],
  ["active", "Working"],
  ["done", "Done"],
  ["failed", "Failed"],
];

// The rooms that open in the side panel: a department's and the open floor.
const opens = (room: Room | undefined) =>
  room?.kind === "department" || room?.kind === "open" ? room.id : undefined;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Walks once per frame until every key is released.
function useWalking(plan: FloorPlan, scale: number) {
  // Until the user walks, the player stands at the plan's start, which moves clear of rooms as they
  // load. Kept outside the floor, so another screen and back finds the player where it was.
  const walked = useOffice((state) => state.player);
  const player = walked ?? plan.start;
  const held = useRef(new Set<string>());
  const frame = useRef<number | undefined>(undefined);
  const last = useRef(0);

  const tick = useCallback(
    (time: number) => {
      // A frame's time can come before the key press that asked for it; never step backwards.
      const seconds = Math.min(0.05, Math.max(0, (time - last.current) / 1000));
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
      const step = (SPEED / scale) * seconds;
      setPlayer((at = plan.start) =>
        clampToFloor({ x: at.x + (x / length) * step, y: at.y + (y / length) * step }, plan),
      );
      frame.current = requestAnimationFrame(tick);
    },
    [plan, scale],
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
  const shift = <T extends Point>(point: T): T => ({ ...point, x: point.x + dx, y: point.y + dy });
  return rooms.map((room) =>
    room.id !== move.id
      ? room
      : {
          ...room,
          rect: shift(room.rect),
          seats: room.seats.map(({ desk, agent }) => ({ desk: shift(desk), agent: shift(agent) })),
          ...(room.pods === undefined
            ? {}
            : { pods: room.pods.map((pod) => ({ ...pod, rect: shift(pod.rect) })) }),
        },
  );
}

// "Claude Code · Haiku 5.5": a model by its display name (D-66).
function detailOf(harness: string, options: SessionOptions): string {
  if (options.model === undefined) return harness;
  const models = lastCatalog(options.harness, options.environment)?.models;
  const name = modelName(models, options.model);
  return name === undefined ? harness : `${harness} · ${name}`;
}

function seatedOf(
  agents: readonly FloorAgent[],
  free: readonly FreeMember[],
  chief: FloorProps["chief"],
  rooms: readonly Room[],
  move: RoomMove | undefined,
): Seated[] {
  const shift = (position: Point): Point =>
    move === undefined || !contains(move.from, position)
      ? position
      : { x: position.x + move.at.x - move.from.x, y: position.y + move.at.y - move.from.y };
  const seated: Seated[] = agents.map((one) => {
    const { agent, state, position, harness, bubble, tokens, part, free: asleep } = one;
    return {
      id: agent.id,
      name: agent.name,
      colour: agent.colour,
      ...(asleep === "before" ? {} : { state }),
      ...(asleep === undefined ? {} : { asleep: true }),
      position: shift(position),
      sessionId: agent.latest.id,
      detail: detailOf(harness, agent.latest.options),
      ...(bubble === undefined ? {} : { bubble }),
      ...(tokens === undefined ? {} : { tokens }),
      ...(part === undefined ? {} : { part }),
    };
  });
  for (const member of free) {
    seated.push({ ...member, position: shift(member.position), asleep: true });
  }
  const office = rooms.find((room) => room.kind === "chief")?.seats[0];
  if (chief === undefined || office === undefined || seated.some(({ id }) => id === chief.id)) {
    return seated;
  }
  return [...seated, { ...chief, position: office.agent, detail: "Chief" }];
}

// Small enough that names still read; below it the floor scrolls.
const MIN_SCALE = 0.6;

// A classic scrollbar's width; 0 where scrollbars float over the content.
function scrollbarWidth(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-200px;visibility:hidden;overflow:scroll;width:100px;height:100px";
  document.body.appendChild(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

// The floor shrinks to fit its pane's width, never grows past full size. It always leaves room for
// a scrollbar: fitting to the width left beside one made the scrollbar come and go, so the floor
// shrank and grew back each frame and flickered.
function useFitScale(floor: RefObject<HTMLDivElement | null>, width: number) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const scroller = floor.current?.parentElement;
    if (scroller === undefined || scroller === null) return;
    const bar = scrollbarWidth();
    const fit = () => {
      const ratio = Math.min(1, Math.max(MIN_SCALE, (scroller.offsetWidth - bar) / width));
      setScale(Math.floor(ratio * 100) / 100);
    };
    const observer = new ResizeObserver(fit);
    // The border box, which a scrollbar coming or going does not change.
    observer.observe(scroller, { box: "border-box" });
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

// A right-click menu, or the dialog it opens, is drawn outside the floor, yet React still passes
// its clicks and keys up to here. Those belong to the menu, so the floor leaves them alone.
const outsideFloor = (event: SyntheticEvent) =>
  !(event.target instanceof Node && event.currentTarget.contains(event.target));

export function Floor(props: FloorProps) {
  const { plan, agents, free, signs, doors, links, linksGoal, chief, selection, room } = props;
  const { onSelect, onOpenRoom, onOpenChat } = props;
  const floor = useRef<HTMLDivElement>(null);
  const scale = useFitScale(floor, plan.width);
  const { player, press, release } = useWalking(plan, scale);
  const you = useRef<HTMLButtonElement>(null);
  const profile = useYou();
  const yourName = profile.name.trim();
  useWalkFromAnywhere(floor, press);
  const [drag, setDrag] = useState<{ from: Point; to: Point }>();
  const { move, handlers, wasClick } = useRoomDrag(plan, scale);
  const rooms = useMemo(() => movedRooms(plan.rooms, move), [plan.rooms, move]);
  const seated = seatedOf(agents, free, chief, rooms, move);
  const drawn = useMemo(() => linkPaths(links, rooms), [links, rooms]);
  const { tokens, done } = useHandoffs(drawn, linksGoal);
  const near = withinReach(player, seated);
  // The room the user stands in. Walking into a room opens its panel; walking out closes it if it
  // is still the one open. Set from where the player stands, so coming back reopens nothing.
  const standing = roomAt(player, plan)?.id;
  const inside = useRef(opens(roomAt(player, plan)));

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
    const entered = opens(roomAt(player, plan));
    if (entered !== undefined && entered !== inside.current) onOpenRoom(entered);
    else if (entered === undefined && inside.current !== undefined && room === inside.current)
      onSelect([]);
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
    if (outsideFloor(event)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key in DIRECTIONS) {
      event.preventDefault();
      press(key);
    } else if (key === "e" && near !== undefined) {
      onSelect([near.id]);
    } else if (key === "Enter" && event.target === event.currentTarget && selection.length === 1) {
      const [only = ""] = selection;
      onOpenChat(only, only === chief?.id ? "chief" : "agent");
    } else if (
      key === "Enter" &&
      event.target === event.currentTarget &&
      selection.length === 0 &&
      room !== undefined &&
      room !== OPEN_FLOOR
    ) {
      // With a department open and no one picked, its chat with the lead.
      onOpenChat(room, "department");
    } else if (key === "Escape") {
      onSelect([]);
      focusAgent(undefined);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || outsideFloor(event)) return;
    if ((event.target as HTMLElement).closest("button") !== null) return;
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
    if (dragged) onSelect(inRect(box, seated).map(({ id }) => id));
    else onClickAt(drag.from);
  };

  // A click inside a room opens it, as its sign does, and leaves an open room as it is. A click
  // outside every room, or on the review desk, goes back to the room the user stands in, and
  // clears the panel only when the user stands in none.
  const onClickAt = (at: Point) => {
    const hit = rooms.find((one) => contains(one.rect, at));
    if (hit?.kind === "chief" && chief !== undefined) {
      onSelect([chief.id]);
      return;
    }
    const opened = opens(hit) ?? opens(roomAt(player, plan));
    if (opened === undefined) onSelect([]);
    else if (opened !== room) onOpenRoom(opened);
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
        {sign.note === undefined ? null : <span>{sign.note}</span>}
        {sign.usage === undefined ? null : <SignUsage usage={sign.usage} />}
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
      aria-label="Office floor. Walk with the arrow keys or WASD and press E to talk to the agent beside you. Enter opens the chat of the agent or department picked. Tab moves between agents. Alt and an arrow key move a room whose sign has focus."
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
        if (kind === "add") return <AddRoom key={id} id={id} rect={rect} />;
        const sign = signs[id];
        const label = signLabel(id, kind);
        const open = kind === "chief" ? chiefSelected : room === id;
        const lifted = move?.id === id && move.lifted;
        const classes = [
          styles.room,
          kind === "guest" ? styles.guestRoom : "",
          kind === "chief" ? styles.chiefRoom : "",
          open ? styles.roomOpen : "",
          standing === id ? styles.roomHere : "",
          lifted ? styles.roomLifted : "",
        ];
        const roomBox = (
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
                onDoubleClick={() => {
                  if (kind === "chief" && chief !== undefined) onOpenChat(chief.id, "chief");
                  else onOpenChat(id, "department");
                }}
              >
                <GripVertical size={13} className={styles.grip} aria-hidden />
                {label}
              </button>
            ) : (
              <span className={styles.sign}>{label}</span>
            )}
            {sign === undefined ||
            (sign.lines.length === 0 && sign.progress === undefined) ? null : (
              <div className={styles.roomLines}>
                {sign.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
                {sign.progress === undefined ? null : (
                  <span className={styles.roomProgress}>
                    <Segments statuses={sign.progress.statuses} />
                    <span className={styles.roomCount}>{sign.progress.label}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        );
        return kind === "department" ? (
          <ContextMenu key={id} menu={() => departmentMenu(id)}>
            {roomBox}
          </ContextMenu>
        ) : (
          roomBox
        );
      })}
      {rooms.flatMap((one) =>
        (one.pods ?? []).map((pod) => {
          const here = inRect(pod.rect, seated).map(({ id }) => id);
          const { x, y, width, height } = pod.rect;
          return (
            <div
              key={`${pod.rect.x},${pod.rect.y}`}
              className={styles.pod}
              style={{ left: x, top: y, width, height }}
            >
              <button
                type="button"
                className={styles.podLabel}
                disabled={here.length === 0}
                title={here.length === 0 ? undefined : "Select everyone here"}
                onClick={() => onSelect(here)}
              >
                <span className={styles.podName}>{pod.label}</span>
                <span className={styles.podCount}>{pod.desks}</span>
              </button>
            </div>
          );
        }),
      )}
      {rooms
        .filter((one) => one.kind !== "add")
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
      {/* Once the profile has a name, the player wears the user's face and name. */}
      <button
        ref={you}
        type="button"
        className={`${styles.you} ${yourName === "" ? "" : styles.youNamed}`}
        style={{ left: player.x - 18, top: player.y - 18 }}
        tabIndex={-1}
        title="Double-click to open your profile"
        aria-label="You. Double-click to open your profile"
        onDoubleClick={() => navigate({ name: "you" })}
      >
        {yourName === "" ? (
          "You"
        ) : (
          <>
            <Avatar name={yourName} colour={profile.colour} size={36} />
            <span className={styles.youName}>{yourName}</span>
          </>
        )}
      </button>
      {seated.map((one) => {
        const { id, name, colour, state, position, bubble, tokens, detail, part, asleep } = one;
        const selected = selection.includes(id);
        const finished = state !== undefined && FINISHED.includes(state);
        return (
          <div key={id} className={styles.seat}>
            {tokens === undefined ? null : (
              <div
                className={styles.tokens}
                style={{ left: position.x, top: position.y - TOKENS_ABOVE }}
                title={`${name} used ${compactCount(tokens)} tokens on this task`}
              >
                {compactCount(tokens)}
              </div>
            )}
            {/* On the desk, as the mockup's: the name tag stays as narrow as before. */}
            {part === undefined ? null : (
              <div
                className={styles.deskCount}
                style={{ left: position.x - DESK.width / 2, top: position.y + DESK_BELOW }}
                aria-hidden
              >
                {/* One fill, not a segment each, so any number of milestones fits the desk. */}
                <span className={styles.deskBar}>
                  <i style={{ width: `${(metCount(part) / part.length) * 100}%` }} />
                </span>
                <span>{fraction(part)}</span>
              </div>
            )}
            {asleep !== true ? null : (
              <div
                className={styles.sleep}
                style={{ left: position.x, top: position.y - (tokens === undefined ? 44 : 86) }}
                aria-hidden
              >
                <span className={styles.doze}>z</span>
                <span className={styles.doze}>z</span>
              </div>
            )}
            {bubble === undefined || asleep === true ? null : (
              <div
                className={`${styles.bubble} ${state === "waiting" ? styles.bubbleWaiting : styles.bubbleWork} ${id === near?.id ? styles.bubbleNear : ""}`}
                // Above the token count, when there is one.
                style={{ left: position.x, top: position.y - (tokens === undefined ? 46 : 88) }}
              >
                {bubble}
              </div>
            )}
            <Tooltip.Root>
              <ContextMenu menu={() => agentMenu(id)}>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    className={`${styles.agent} ${finished || asleep === true ? styles.finished : ""}`}
                    style={{ left: position.x - 40, top: position.y - 18 }}
                    aria-pressed={selected}
                    aria-label={`${name}, ${detail}, ${(state === undefined ? "Free" : STATE_LABELS[state]).toLowerCase()}`}
                    onClick={(event) => {
                      const adding = event.shiftKey || event.ctrlKey || event.metaKey;
                      if (!adding) onSelect([id]);
                      else if (selected) onSelect(selection.filter((one) => one !== id));
                      else onSelect([...selection, id]);
                    }}
                    onDoubleClick={(event) => {
                      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                      onOpenChat(id, id === chief?.id ? "chief" : "agent");
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || !selected || selection.length > 1) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenChat(id, id === chief?.id ? "chief" : "agent");
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
              </ContextMenu>
              <Tooltip.Portal>
                {/* Below, as the work bubble shows above the agent at the same moment. */}
                <Tooltip.Content className={styles.tooltip} side="bottom" sideOffset={6}>
                  {detail}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        );
      })}

      {near === undefined ? null : (
        <div
          className={styles.hint}
          style={{ left: player.x, top: player.y + (yourName === "" ? 26 : 44) }}
          aria-hidden
        >
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

// Folded into the sign; it opens while the room is open or the user stands in it.
function SignUsage({ usage }: { usage: NonNullable<RoomSign["usage"]> }) {
  return (
    <span className={styles.signUsage}>
      <span className={styles.signUsageInner}>
        <strong>{compactCount(usage.total)}</strong> tokens
        {usage.apps.map((app) => (
          <span key={app.name} className={styles.signUsageApp}>
            {app.name} <strong>{compactCount(app.tokens)}</strong>
          </span>
        ))}
      </span>
    </span>
  );
}

function AddRoom({ id, rect }: { id: string; rect: Rect }) {
  const chief = id === ADD_CHIEF;
  return (
    <button
      type="button"
      className={styles.addRoom}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onClick={() => navigate(chief ? { name: "chief" } : { name: "new-department" })}
    >
      <Plus size={18} aria-hidden />
      <strong>{chief ? "Chief's office" : "New department"}</strong>
      <span>{chief ? "Set up a chief" : "Describe it or build it by hand"}</span>
    </button>
  );
}
