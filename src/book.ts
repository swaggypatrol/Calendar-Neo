import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';
import { DayRange } from './range';

/** On release, turn the page if it has gone this far, otherwise fall back; a fast enough flick also counts. */
const COMMIT = 0.3;
const FLICK_SPEED = 0.35;
/** How many pixels the finger must move sideways before it counts as a drag. */
const DRAG_PX = 6;
/** How far out (in months from today) the page edges are shown along the fore-edges. */
const HORIZON = 24;

/** How far a lifted page corner bulges up (or down) during a turn, as a fraction of the page height. */
const LIFT = 0.22;

/**
 * Motion of the sheet when nobody is holding it: a critically damped spring (no bounce) that takes over the speed the
 * finger had, swings the page over, slows it down naturally and lays it down exactly flat. Stiffness in rad/s.
 */
const TURN_OMEGA = 12;
/** Falling back: into the resting curl (the right page) or flat. */
const SETTLE_OMEGA = 14;
/** The resting corner gets out of the way quickly when the left page is about to turn back. */
const CLEAR_OMEGA = 34;
/** The resting corner: a softer spring, so it eases into its curl and follows its breathing without a jolt. */
const PEEL_OMEGA = 6.5;
/** Riffling through several pages (bookmark jumps, quick swipes in a row): a steady speed, in pages per second. */
const RIFFLE_SPEED = 3.4;
const RIFFLE_ACCEL = 14;
/** Landed: within half a pixel of the destination and barely moving (px/s). */
const LAND_PX = 0.5;
const LAND_PX_S = 10;
/** After a page lands it lies flat for a moment before the next corner relaxes into its resting curl. */
const LAND_PAUSE_MS = 280;
/** Pages for the months around the open spread are prepared in small slices of idle time, never in an animation frame. */
const PREPARE_SLICE_MS = 30;

/** Run some work when the browser is idle (between frames), so it never stalls an animation. */
const whenIdle = (fn: () => void): void => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 200 });
  else setTimeout(fn, 16);
};

interface Pt {
  x: number;
  y: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);

/** Cut a polygon with a straight line, keeping the half where keep(point) >= 0. */
function clipPoly(poly: Pt[], side: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

const polyCss = (pts: Pt[]) =>
  pts.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${pts.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(', ')})`;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** An affine map of the plane, in CSS matrix order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Aff = [number, number, number, number, number, number];
const ap = (m: Aff, q: Pt): Pt => ({ x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] });
const inv = (m: Aff): Aff => {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthIndex = (y: number, m0: number) => y * 12 + m0;
const m0Of = (k: number) => ((k % 12) + 12) % 12;
const keyOf = (k: number) => `${Math.floor(k / 12)}-${pad2(m0Of(k) + 1)}`;
const parseKey = (s: string): number | null => {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  return m ? monthIndex(Number(m[1]), Math.min(11, Math.max(0, Number(m[2]) - 1))) : null;
};

/** The golden ratio: the page margins, the binding and the bookmarks are all laid out with it. */
const PHI = (1 + Math.sqrt(5)) / 2;

/** Page margins: m on the outer edge and at the top, m·φ on the binding side (room for the punched holes), m/φ at the bottom. */
const MARGIN = 16;
const MARGIN_INNER = Math.round(MARGIN * PHI);
const MARGIN_BOTTOM = Math.round(MARGIN / PHI);

/**
 * The spiral binding. Holes are punched every PITCH px down the inner edge of every sheet; a hole is PITCH/φ² across and
 * its centre sits PITCH/φ in from the edge. The two pages lie PITCH/φ apart and the coil runs through both rows of holes.
 */
const PITCH = 17;
const HOLE_R = PITCH / PHI ** 2 / 2;
const HOLE_INSET = PITCH / PHI;
const SPINE = Math.round(PITCH / PHI);
/** Half the gap: a sheet's inner edge sits this far from the coil's axis, which the sheets turn about. */
const HALF = SPINE / 2;
/** Across the coil, hole to hole. */
const COIL = 2 * (HALF + HOLE_INSET);
/**
 * The coil's wire seen end on: a circle round the spine, through the holes of both open pages. A turning sheet's hole
 * column rides over the top of it from one page to the other.
 */
const HOLE_U = HALF + HOLE_INSET;
const WIRE_Z = 7;
const WIRE_R = Math.hypot(HOLE_U, WIRE_Z);
const WIRE_A0 = -Math.atan2(WIRE_Z, HOLE_U);
/**
 * How far the bend may slant as it nears the binding (px from the coil's axis, where it crosses mid-height): beyond
 * SLANT_FREE it slants however the hand pulls; in to STRAIGHT_BY it straightens out until its near end can come no
 * closer than halfway to the holes.
 */
const SLANT_FREE = 260;
const STRAIGHT_BY = 34;
/** Where the light comes from: the upper left, a little in front. */
const LIGHT = (() => {
  const l = Math.hypot(0.35, 0.45, 1);
  return { x: -0.35 / l, y: -0.45 / l, z: 1 / l };
})();

/**
 * The bend of a sheet folded flat so that its corner C lands on Q: the perpendicular bisector of the two (points q with
 * n·q = k), and where it crosses mid-height (of a sheet H tall).
 */
const creaseOf = (Q: Pt, C: Pt, H: number) => {
  const d = sub(C, Q);
  const l = len(d) || 1e-9;
  const n = { x: d.x / l, y: d.y / l };
  const k = (dot(n, C) + dot(n, Q)) / 2;
  const m = k - n.y * (H / 2);
  return { n, k, mid: n.x > 1e-9 ? m / n.x : m >= 0 ? Infinity : -Infinity };
};

/**
 * How steeply the bend may slant (the tangent of its angle to the binding) when it crosses mid-height `mid` px from the
 * coil's axis. The coil holds the sheet's whole edge, so the bend can never reach past the holes at either end, and
 * nearing the binding the paper's own stiffness straightens it further; while only the corner is curled it may slant as
 * the hand pulls.
 */
const slantLimit = (mid: number, H: number): number => {
  const t = clamp01((SLANT_FREE - mid) / (SLANT_FREE - STRAIGHT_BY));
  const w = t * t * (3 - 2 * t);
  return w > 0 ? (2 * Math.max(0, mid - HOLE_U)) / H / ((1 + w) * w) : Infinity;
};

/**
 * A bend this near level (its normal's x no more than this) is a corner pulled up the page, folding over a strip along its
 * edge: the coil doesn't limit that. LEVEL_TAN is the steepest slant short of it.
 */
const LEVEL = 0.2;
const LEVEL_TAN = Math.sqrt(1 / LEVEL ** 2 - 1);

/** Whether the coil lets the sheet bend like this. */
const slantOk = (Q: Pt, C: Pt, H: number): boolean => {
  const { n, mid } = creaseOf(Q, C, H);
  if (!(n.x > -0.02)) return false;
  return n.x <= LEVEL || Math.abs(n.y) <= n.x * slantLimit(mid, H) + 1e-9;
};

/** The flat-fold corner of a bend crossing mid-height at `mid` and slanting as far as it may, its far end towards `side`. */
const slantQ = (mid: number, side: number, C: Pt, H: number): Pt => {
  const t = Math.min(1e6, slantLimit(mid, H));
  const m = Math.hypot(1, t);
  const n = { x: 1 / m, y: (side * t) / m };
  const d = dot(n, C) - (n.x * mid + n.y * (H / 2));
  return { x: C.x - 2 * d * n.x, y: C.y - 2 * d * n.y };
};

/** Uncoated paper's grain, for the matte panel the days are printed on: faint fibres, darker on light paper, lighter on dark. */
const grain = (r: number, g: number, b: number, a: number) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">` +
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/>` +
    `<feColorMatrix values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${a} ${(-a * 0.42).toFixed(3)}"/></filter>` +
    `<rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
const GRAIN_LIGHT = grain(0.36, 0.29, 0.19, 0.42);
const GRAIN_DARK = grain(0.85, 0.85, 0.82, 0.22);
/** How far beside the wire its shadow falls on the paper. */
const WIRE_SHADOW = 3.5;
/** Room above and below the pages for the coil's ends (and their shadows), and round the book for the bookmarks. */
const ROOM_TOP = 10;
const ROOM_BOTTOM = 10;
const PAD_X = 40;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;

/** One turn of the coil seen from above: a wire rising out of a hole on the left page, over the spine, into the right page. */
const coilTile = (c: { dark: string; mid: string; light: string; glint: number; shadow: number }) => {
  const l = 22 - COIL / 2;
  const r = 22 + COIL / 2;
  const y = PITCH / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 ${PITCH}" preserveAspectRatio="none">` +
    `<defs><linearGradient id="m" x1="0" x2="1"><stop offset="0" stop-color="${c.dark}"/><stop offset=".28" stop-color="${c.mid}"/>` +
    `<stop offset=".5" stop-color="${c.light}"/><stop offset=".74" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.dark}"/></linearGradient>` +
    `<linearGradient id="g" x1="0" x2="1"><stop offset=".22" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset=".47" stop-color="#fff" stop-opacity="${c.glint}"/><stop offset=".78" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<filter id="b" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="1"/></filter></defs>` +
    // its shadow on the paper, then the wire, then a glint along its top
    `<path d="M${l + 1} ${y + 3.4}Q22 ${y - 2.6} ${r + 1} ${y + 1.2}" fill="none" stroke="#000" stroke-opacity="${c.shadow}" stroke-width="2.4" stroke-linecap="round" filter="url(#b)"/>` +
    `<path d="M${l} ${y + 1.1}Q22 ${y - 5} ${r} ${y - 1.1}" fill="none" stroke="url(#m)" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M${l + 2} ${y + 0.2}Q22 ${y - 5.7} ${r - 2} ${y - 1.9}" fill="none" stroke="url(#g)" stroke-width=".8" stroke-linecap="round"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
const COIL_LIGHT = coilTile({ dark: '#767c84', mid: '#c3c8ce', light: '#f1f3f5', glint: 0.9, shadow: 0.3 });
const COIL_DARK = coilTile({ dark: '#3f444b', mid: '#7f868e', light: '#c9ced4', glint: 0.55, shadow: 0.55 });

const DARK_VARS = /* css */ `
    --hb-paper: #2f3238;
    --hb-paper-edge: #45484f;
    --hb-line: rgba(255, 255, 255, 0.07);
    --hb-shadow: rgba(0, 0, 0, 0.45);
    --hb-hole: rgba(8, 9, 11, 0.78);
    --hb-hole-rim: rgba(0, 0, 0, 0.35);
    --hb-hollow: rgba(0, 0, 0, 0.42);
    --hb-gloss: rgba(255, 255, 255, 0.055);
    --hb-sheen-dim: rgba(0, 0, 0, 0.12);
    --hb-matte: #2c2f35;
    --hb-grain: ${GRAIN_DARK};
    --hb-coil: ${COIL_DARK};`;

const STYLE = /* css */ `
:host {
  --hb-paper: #fbf8f2;
  --hb-paper-edge: #e9e3d6;
  --hb-line: rgba(60, 45, 25, 0.07);
  --hb-shadow: rgba(40, 30, 15, 0.18);
  --hb-ink: #ffd21f;
  --hb-hole: rgba(58, 44, 26, 0.62);
  --hb-hole-rim: rgba(58, 44, 26, 0.22);
  --hb-hollow: rgba(60, 45, 25, 0.2);
  --hb-gloss: rgba(255, 255, 255, 0.95);
  --hb-sheen-dim: rgba(90, 70, 40, 0.06);
  --hb-matte: #f6f2ea;
  --hb-grain: ${GRAIN_LIGHT};
  --hb-coil: ${COIL_LIGHT};
  --hb-pitch: ${PITCH}px;
  --hc-card-width: 22rem;
  --hb-ease: cubic-bezier(0.65, 0, 0.35, 1);
  display: block;
}
/* Dark theme: follows the system unless theme="light"; theme="dark" forces it */
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {${DARK_VARS}
  }
}
:host([theme="dark"]) {${DARK_VARS}
}
.book {
  position: relative;
  width: max-content;
  margin: 0 auto;
  padding: ${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px;
  touch-action: pan-y;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
}
.spread {
  position: relative;
  display: grid;
  grid-template-columns: auto auto;
  column-gap: ${SPINE}px;
}
/* Coated paper, glossy: a soft sheen and a brighter streak across it, as it catches the light. The grid of days is printed
   on a matte panel (see highlighter-calendar below): the only part that takes ink. The glossy margin round it is for
   holding the page (ink would only smear on it) */
.page, .turn {
  position: relative;
  box-sizing: border-box;
  padding: ${MARGIN}px ${MARGIN}px ${MARGIN_BOTTOM}px;
  background:
    linear-gradient(122deg, transparent 8%, var(--hb-gloss) 27%, transparent 46%, transparent 74%, color-mix(in srgb, var(--hb-gloss) 60%, transparent) 84%, transparent 94%),
    linear-gradient(122deg, var(--hb-sheen-dim), transparent 22%, transparent 56%, var(--hb-sheen-dim)),
    radial-gradient(120% 90% at 50% 40%, transparent 60%, rgba(120, 90, 40, 0.05)),
    var(--hb-paper);
}
.shape-l { border-radius: 10px 2px 2px 10px; padding-right: ${MARGIN_INNER}px; }
.shape-r { border-radius: 2px 10px 10px 2px; padding-left: ${MARGIN_INNER}px; }
/* Above the bookmark tabs: a tab sticks out from under the sheets lying on top of its own */
.page { z-index: 1; transition: box-shadow 0.45s; }
.page.left { box-shadow: var(--edges-left, none), -6px 14px 28px -10px var(--hb-shadow); }
.page.right { box-shadow: var(--edges-right, none), 6px 14px 28px -10px var(--hb-shadow); }
/* The page underneath a turning (or resting, peeled) sheet: only its exposed corner shows, and grabbing it pulls the sheet */
.page.under { cursor: grab; }
.page.under highlighter-calendar { pointer-events: none; }
/* The binding edge of every sheet: a column of punched holes (you look down through the stack, so they are dark), and only a
   faint shade, because spiral-bound pages lie flat. Part of the sheet, so the holes turn with it */
.gutter {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  --hole: radial-gradient(circle at ${HOLE_INSET}px 50%, var(--hb-hole) 0 ${(HOLE_R - 0.9).toFixed(2)}px, var(--hb-hole-rim) ${(HOLE_R - 0.1).toFixed(2)}px, transparent ${(HOLE_R + 0.6).toFixed(2)}px);
}
.shape-l .gutter {
  background:
    var(--hole) 100% 0 / ${2 * HOLE_INSET}px var(--hb-pitch) repeat-y,
    linear-gradient(to left, rgba(0, 0, 0, 0.07), rgba(0, 0, 0, 0.02) 4%, transparent 9%);
}
.shape-r .gutter {
  background:
    var(--hole) 0 0 / ${2 * HOLE_INSET}px var(--hb-pitch) repeat-y,
    linear-gradient(to right, rgba(0, 0, 0, 0.07), rgba(0, 0, 0, 0.02) 4%, transparent 9%);
}
/* Light and shade while turning: a gradient along the fold line. On the page below it is the shadow cast by the lifted sheet; on the sheet it is the shading of the curled surface */
.fx {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
}
.strip {
  position: absolute;
  left: 0;
  top: 0;
  width: 4000px;
  transform-origin: 0 0;
  visibility: hidden;
}
/* The sheet being turned: the front stays in place, clipped along the fold line to drop the folded part; the back is mirrored across the fold line and laid on top.
   "inherit", never "visible": when the book itself is hidden (the date field closed), the sheet must hide with it */
.turn {
  position: absolute;
  top: 0;
  visibility: hidden;
  transform-origin: 0 0;
}
.turn.on { visibility: inherit; }
.flap {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
}
.turn.front, .turn.margin { z-index: 4; }
/* The inner part's back, once it has swung past upright: only the blank margin and its holes are printed there */
.turn.margin { padding: 0; }
.tint { position: absolute; inset: 0; }
/* The folded-over flap is something to grab, not to draw on */
.turn.back { pointer-events: auto; cursor: grab; }
.turn.back highlighter-calendar { pointer-events: none; }
.pool {
  position: absolute;
  left: -10000px;
  top: 0;
  visibility: hidden;
}
highlighter-calendar {
  display: block;
  width: var(--hc-card-width);
  --hc-bg: transparent;
  --hc-line: var(--hb-line);
  --hc-grid-paper: var(--hb-grain), var(--hb-matte);
}
/* The spine: the gap between the pages and the coil over it. The coil runs through the holes of every sheet lying open, so
   it is drawn over them; a sheet lifted to turn rises above it and covers it, except along its own punched edge, which
   stays threaded on the coil */
.spine {
  position: absolute;
  left: 50%;
  width: 56px;
  margin-left: -28px;
  top: -${ROOM_TOP}px;
  bottom: -${ROOM_BOTTOM}px;
  z-index: 3;
  pointer-events: none;
}
.hollow {
  position: absolute;
  left: 50%;
  width: ${SPINE}px;
  margin-left: -${SPINE / 2}px;
  top: ${ROOM_TOP}px;
  bottom: ${ROOM_BOTTOM}px;
  background: linear-gradient(to right, var(--hb-hollow), color-mix(in srgb, var(--hb-hollow) 45%, transparent) 50%, var(--hb-hollow));
}
.coil {
  position: absolute;
  left: 0;
  right: 0;
  top: ${ROOM_TOP}px;
  bottom: ${ROOM_BOTTOM}px;
  background: var(--hb-coil) 50% 0 / 44px var(--hb-pitch) repeat-y;
}
/* The same coil again, over each part of the turning sheet: drawn over it only where the wire stands higher than it */
.spine.over { clip-path: polygon(0 0, 0 0, 0 0); }
.spine.over.a { z-index: 5; }
.spine.over.b { z-index: 7; }
/* The second leaf: a page taken hold of while the other sheet is still dropping back flat goes over it */
.turn.front.l1, .turn.margin.l1 { z-index: 14; }
.spine.over.a.l1 { z-index: 15; }
.flap.l1 { z-index: 16; }
.spine.over.b.l1 { z-index: 17; }
/* The page corners: click (or press and pull) to turn. The right one is the real sheet, peeled back and breathing */
.corner {
  position: absolute;
  bottom: ${PAD_BOTTOM}px;
  width: 72px;
  height: 72px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  z-index: 9;
}
.corner.next { right: ${PAD_X}px; }
.corner.prev { left: ${PAD_X}px; }
.corner[disabled] { pointer-events: none; }
.corner:focus { outline: none; }
.corner:focus-visible { outline: 2px solid color-mix(in srgb, var(--hb-ink) 70%, transparent); outline-offset: -10px; border-radius: 14px; }
/* Bookmarks: one per month, always the same element. When its page isn't open it is a tab sticking out from the fore-edge,
   from under the sheets lying on top of its own; when its page is open it slides into the page and becomes a swallowtail
   ribbon lying on it, hanging from the top (under any sheet turning over it). Every change is animated; nothing jumps */
.mark {
  position: absolute;
  z-index: 0;
  box-sizing: border-box;
  border: 0;
  padding: 0;
  font: 700 10px/1 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #3a2f12;
  text-align: center;
  white-space: nowrap;
  background: color-mix(in srgb, var(--hb-ink) 88%, #ffffff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  transition:
    left 0.6s var(--hb-ease), top 0.6s var(--hb-ease), width 0.6s var(--hb-ease), height 0.6s var(--hb-ease),
    padding 0.6s var(--hb-ease), border-radius 0.6s var(--hb-ease), clip-path 0.6s var(--hb-ease),
    box-shadow 0.6s, opacity 0.35s, translate 0.15s;
}
/* A ribbon lies on its open page, even while that sheet's corner is peeled back at rest, and under any part of a sheet
   that folds over it */
.mark.ribbon { z-index: 5; cursor: default; box-shadow: none; }
.mark.edge-r:hover { translate: 3px 0; }
.mark.edge-l:hover { translate: -3px 0; }
.mark.gone { opacity: 0; pointer-events: none; }
/* Gone with its sheet while that sheet turns over (or while pages riffle past): it comes back where it belongs once the
   page lies flat */
.mark.away { opacity: 0; pointer-events: none; transition: opacity 0.15s; }
`;

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay', 'min', 'max', 'theme'];

/**
 * The sheet moving on its own: along a path from where the corner is to where it is going (with an arc that rises and
 * falls smoothly), driven either by a critically damped spring or, when riffling, by a steady speed.
 * s is the position along the path (0 → 1), v its speed per second.
 */
interface Motion {
  from: Pt;
  to: Pt;
  lift: number;
  s: number;
  v: number;
  /**
   * Where the spring is pulling. It starts just far enough ahead that the page neither jerks nor brakes at the moment
   * it is let go, and glides on to the destination (1): from rest the page eases into motion, a flicked page keeps its speed.
   */
  g: number;
  omega: number;
  /** > 0: riffle at this steady speed (after accelerating up to it at accel). */
  speed: number;
  accel: number;
  /** Length of the path in px, to judge the landing in pixels. */
  dist: number;
  /** The page is within a few pixels of lying flat: the bookmarks have been put back. */
  landed?: boolean;
  /**
   * What happens on arrival: the page has turned, it has fallen back flat, it has settled into the resting curl, or the
   * resting corner has dropped flat to make way for turning the left page back.
   */
  kind: 'turn' | 'back' | 'rest';
}

/** How a turning sheet is bent at one moment (see bend()). Sheet points are in mirrored coordinates, flat. */
interface Bend {
  alpha: number;
  ca: number;
  sa: number;
  /** The bend: points q with n·q = k. */
  n: Pt;
  k: number;
  /** The inner part (between the binding and the bend) and the outer part (beyond it, with the corner). */
  keep: Pt[];
  fold: Pt[];
  /** Sheet point → screen (mirrored), for each part, and its height above the pages. */
  inner: Aff;
  outer: Aff;
  innerZ: (q: Pt) => number;
  outerZ: (q: Pt) => number;
}

/**
 * One page turn. All geometry is computed in "mirrored coordinates": the origin is at the top of the gutter and the turning page is always on the right, x∈[0,W];
 * turning backwards (dir=-1) mirrors everything left to right. corner is the lifted page corner, P is where that corner has been pulled to,
 * and the sheet folds along the perpendicular bisector of C and P.
 */
interface Flip {
  dir: 1 | -1;
  top: boolean;
  P: Pt;
  motion: Motion | null;
  /** Resting: the right page's corner is gently peeled back and breathing, ready to be pulled further. */
  idle?: boolean;
  /** Where the corner would be if the sheet were folded flat, for P to show where it does (kept for the next frame). */
  Q?: Pt;
  /** The elements it is drawn with. */
  leaf: Leaf;
}

/**
 * One set of elements a turning sheet is drawn with: its front and back, the inner part's back once it has swung past
 * upright, the light on each, and the coil drawn again over each part. There are two, so one sheet can drop back flat
 * while the other page is already being taken hold of.
 */
interface Leaf {
  front: HTMLElement;
  back: HTMLElement;
  margin: HTMLElement;
  frontTint: HTMLElement;
  marginTint: HTMLElement;
  backTint: HTMLElement;
  overA: HTMLElement;
  overACoil: HTMLElement;
  overB: HTMLElement;
  overBCoil: HTMLElement;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  t: number;
  /** 'idle' not moved yet; 'drag' the sheet follows the finger; 'flick' one more turn while a turn is running; 'scroll' vertical, ignored */
  mode: 'idle' | 'drag' | 'flick' | 'scroll';
  samples: { t: number; x: number }[];
  origin: Pt;
  /** Pressed on a page corner (or the peeled-back corner of the next sheet): a tap there turns the page. */
  corner: 1 | -1 | 0;
}

/** A two-finger trackpad swipe being followed. */
interface Wheel {
  dir: 1 | -1;
  dx: number;
  origin: Pt;
  samples: { t: number; x: number }[];
  timer: number;
  /** For telling the fingers apart from the momentum that follows them: the largest step so far, the last one, and how many shrank in a row. */
  peak: number;
  last: number;
  shrinking: number;
  events: number;
}

/**
 * <highlighter-book>: an open spiral-bound paper calendar. Two facing pages, with a month printed on each side of every sheet,
 * so two months are always open at once; every sheet is punched along its inner edge and turns round the coil like real paper.
 *
 * - Only the grid of days, printed on matte paper, takes the highlighter; the glossy margin round it is where the page is
 *   taken hold of to turn it. A finger highlights; tapping a day twice wipes its ink off (or the right button erases).
 * - Margins, the day grid, the coil and where the bookmarks sit all follow the golden ratio.
 * - The right page's bottom corner rests slightly peeled back, breathing. It is the real sheet: click it, or pull it, and
 *   the same curl carries on into a full turn.
 * - Press on the margin (outside the grid of days) and drag, or swipe sideways with two fingers on a trackpad: drag left and
 *   the right page follows your finger over; drag right and the left page turns back. Let go past about a third, or with a
 *   flick, and the page carries on and settles flat; otherwise it falls back. A tap on the margin turns that page. Quick
 *   swipes in a row riffle page after page.
 * - A month with selected days sticks a bookmark out of the fore-edge; click it to jump to that month.
 * - Days already past are printed in grey (and so is a month's title once all of it is past).
 * Attributes and input / change events are the same as <highlighter-calendar>; it also has month (the left page's month) and next() / prev().
 */
export class HighlighterBook extends HTMLElement {
  static observedAttributes = ['month', 'value', ...FORWARDED];

  private $book: HTMLElement;
  private $left: HTMLElement;
  private $right: HTMLElement;
  private $spread: HTMLElement;
  private $pool: HTMLElement;
  /** One bookmark for each month with a selection (month index → element). */
  private marks = new Map<number, HTMLButtonElement>();
  private $prev: HTMLButtonElement;
  private $next: HTMLButtonElement;
  /** The two sets of elements turning sheets are drawn with (the second one only while the first sheet settles). */
  private leaves: Leaf[];
  /** Keeps the holes (and the coil running through them) evenly spaced down the page whatever its height. */
  private sizer: ResizeObserver | null = null;
  /** Six pages: the two open ones, plus the two either side prepared ahead of time so a turn never has to wait for one. */
  private pages: HighlighterCalendar[] = [];
  /** The left page's month (month index = year * 12 + month). The right page is m + 1. */
  private m: number;
  private flip: Flip | null = null;
  /** The resting corner dropping back flat on its own, while the left page is turned back. */
  private settling: Flip | null = null;
  private settleRaf = 0;
  /** Page turns requested while a turn is in progress. */
  private queue: (1 | -1)[] = [];
  private raf = 0;
  private lastT = 0;
  private idleRaf = 0;
  private lastIdle = 0;
  /** How far the resting corner is peeled back (px) and how fast that is changing. */
  private peel = 0;
  private peelV = 0;
  private peelHover = false;
  private hintAt = -Infinity;
  private settleTimer = 0;
  private selection: string[] = [];
  private range = new DayRange();
  private gesture: Gesture | null = null;
  /** Trackpad two-finger swipe in progress, and a short lock that swallows the momentum tail after it ends. */
  private wheel: Wheel | null = null;
  private wheelLock = 0;
  private tailStep = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="book" part="book">
        <div class="spread">
          <div class="page left shape-l"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div>
          <div class="page right shape-r"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div>
          <div class="turn front"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="tint"></div><div class="strip"></div></div></div>
          <div class="turn margin"><div class="gutter"></div><div class="fx"><div class="tint"></div><div class="strip"></div></div></div>
          <div class="flap"><div class="turn back"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="tint"></div><div class="strip"></div></div></div></div>
          <div class="spine">
            <div class="hollow"></div>
            <div class="coil"></div>
          </div>
          <div class="spine over a" aria-hidden="true">
            <div class="coil"></div>
          </div>
          <div class="spine over b" aria-hidden="true">
            <div class="coil"></div>
          </div>
          <div class="turn front l1"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="tint"></div><div class="strip"></div></div></div>
          <div class="turn margin l1"><div class="gutter"></div><div class="fx"><div class="tint"></div><div class="strip"></div></div></div>
          <div class="flap l1"><div class="turn back l1"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="tint"></div><div class="strip"></div></div></div></div>
          <div class="spine over a l1" aria-hidden="true"><div class="coil"></div></div>
          <div class="spine over b l1" aria-hidden="true"><div class="coil"></div></div>
        </div>
        <button class="corner prev" type="button" aria-label="Previous page"></button>
        <button class="corner next" type="button" aria-label="Next page"></button>
        <div class="pool" aria-hidden="true"></div>
      </div>`;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$book = q('.book');
    this.$left = q('.page.left');
    this.$right = q('.page.right');
    this.$spread = q('.spread');
    this.$pool = q('.pool');
    this.$prev = q('.corner.prev');
    this.$next = q('.corner.next');
    const leaf = (c: string): Leaf => ({
      front: q(`.turn.front${c}`),
      back: q(`.turn.back${c}`),
      margin: q(`.turn.margin${c}`),
      frontTint: q(`.turn.front${c} .tint`),
      marginTint: q(`.turn.margin${c} .tint`),
      backTint: q(`.turn.back${c} .tint`),
      overA: q(`.spine.over.a${c}`),
      overACoil: q(`.spine.over.a${c} .coil`),
      overB: q(`.spine.over.b${c}`),
      overBCoil: q(`.spine.over.b${c} .coil`),
    });
    this.leaves = [leaf(':not(.l1)'), leaf('.l1')];

    for (let i = 0; i < 6; i++) {
      const c = document.createElement('highlighter-calendar');
      c.setAttribute('hide-nav', '');
      c.addEventListener('input', () => this.sync(c));
      c.addEventListener('change', () => this.sync(c));
      c.addEventListener('monthchange', (e) => {
        e.stopPropagation();
        this.onPageMonth(c);
      });
      this.pages.push(c);
      this.$pool.append(c);
    }
    const now = new Date();
    this.m = monthIndex(now.getFullYear(), now.getMonth());
    this.holder(this.$left).append(this.pages[0]);
    this.holder(this.$right).append(this.pages[1]);

    // Pointer taps on the corners are handled by the gesture (so the corner can also be pulled); this is for the keyboard
    this.$prev.addEventListener('click', (e) => e.detail === 0 && this.prev());
    this.$next.addEventListener('click', (e) => e.detail === 0 && this.next());
    this.$book.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$book.addEventListener('pointermove', (e) => this.onMove(e));
    this.$book.addEventListener('pointerup', (e) => this.onUp(e, false));
    this.$book.addEventListener('pointercancel', (e) => this.onUp(e, true));
    this.$book.addEventListener('pointerleave', () => (this.peelHover = false));
    this.$book.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  connectedCallback(): void {
    this.layout();
    this.sizer = new ResizeObserver(() => this.spaceHoles());
    this.sizer.observe(this.$right);
    this.afterLanding(300);
  }

  disconnectedCallback(): void {
    this.sizer?.disconnect();
    this.sizer = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    cancelAnimationFrame(this.idleRaf);
    this.idleRaf = 0;
    clearTimeout(this.settleTimer);
    this.settleTimer = 0;
    if (this.wheel) clearTimeout(this.wheel.timer);
    this.wheel = null;
    this.gesture = null;
    this.queue = [];
    if (this.settling) this.finishFlip(false, this.settling);
    if (this.flip) this.finishFlip(!this.flip.idle && this.flip.motion?.kind === 'turn');
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    if (name === 'month') {
      if (v) this.show(v);
    } else if (name === 'value') {
      this.value = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      for (const c of this.pages) {
        if (v === null) c.removeAttribute(name);
        else c.setAttribute(name, v);
      }
      if (name === 'color') this.style.setProperty('--hb-ink', v ?? '#ffd21f');
      if (name === 'min' || name === 'max') {
        this.range.set(name, v);
        this.selection = this.pages[0].value;
        this.selectionChanged();
        this.show(keyOf(this.m));
      }
    }
  }

  // ---------- Public API ----------

  get value(): string[] {
    return [...this.selection];
  }

  set value(keys: string[]) {
    this.selection = [...new Set(keys)].sort();
    for (const c of this.pages) c.value = this.selection;
    this.selectionChanged();
  }

  /** The left page's month, YYYY-MM. */
  get month(): string {
    return keyOf(this.m);
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  get tool(): Tool {
    return this.pages[0].tool;
  }

  set tool(t: Tool) {
    for (const c of this.pages) c.tool = t;
  }

  /** The book's full width, bookmarks and all (for laying out whatever holds it). */
  get naturalWidth(): number {
    return this.$book.offsetWidth || 2 * (this.$right.offsetWidth || 394) + SPINE + 2 * PAD_X;
  }

  get color(): string {
    return this.pages[0].color;
  }

  set color(v: string) {
    this.style.setProperty('--hb-ink', v);
    for (const c of this.pages) c.color = v;
  }

  get threshold(): number {
    return this.pages[0].threshold;
  }

  set threshold(n: number) {
    for (const c of this.pages) c.threshold = n;
  }

  clear(): void {
    const before = this.selection;
    if (!before.length) return;
    this.selection = [];
    for (const c of this.pages) c.clear(true);
    this.selectionChanged();
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: [], added: [], removed: before }, bubbles: true, composed: true }),
    );
  }

  /** Turn forward one page (the right page turns over to the left). */
  next(): void {
    this.request(1);
  }

  /** Turn back one page (the left page turns back to the right). */
  prev(): void {
    this.request(-1);
  }

  /** Open straight to a given month on the left page, without animation. */
  show(month: string): void {
    const k = parseKey(month);
    if (k === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stopIdle();
    if (this.settling) this.finishFlip(false, this.settling);
    if (this.flip) this.finishFlip(false);
    this.queue = [];
    this.m = this.clampLeft(k);
    this.layout(true);
    // Usually called right before the date field opens: prepare the neighbouring pages after its opening animation
    this.afterLanding(650);
  }

  /** Lift the resting corner higher for a moment and let it settle back, hinting that pages can be turned. */
  hint(): void {
    this.hintAt = performance.now();
    if (!this.flip) this.afterLanding(0);
  }

  /** Space the holes evenly down the page, a whole number of them, so the coil passes through every one exactly. */
  private spaceHoles(): void {
    const H = this.$right.offsetHeight;
    if (!H) return;
    const pitch = H / Math.max(1, Math.round(H / PITCH));
    this.$book.style.setProperty('--hb-pitch', `${pitch.toFixed(3)}px`);
  }

  // ---------- Pages ----------

  private holder(el: HTMLElement): HTMLElement {
    return el.querySelector('.slot') as HTMLElement;
  }

  private get todayIndex(): number {
    const now = new Date();
    return monthIndex(now.getFullYear(), now.getMonth());
  }

  /** The earliest and latest month the left page can show (at least one of the two pages must be within the selectable range). */
  private clampLeft(k: number): number {
    this.range.refresh();
    return Math.min(this.range.maxMonth, Math.max(this.range.minMonth - 1, k));
  }

  private canFlip(dir: 1 | -1): boolean {
    this.range.refresh();
    return dir > 0 ? this.m + 2 <= this.range.maxMonth : this.m + 1 - 2 >= this.range.minMonth;
  }

  /** Set a page (calendar element) to a month; if it already shows that month, leave it alone (keeping any hand-drawn strokes). */
  private setMonth(el: HighlighterCalendar, k: number): void {
    const key = keyOf(k);
    if (el.month !== key) el.month = key;
  }

  /** A spare page already showing month k. */
  private spareFor(k: number): HighlighterCalendar | undefined {
    const key = keyOf(k);
    return this.pages.find((c) => c.parentElement === this.$pool && c.month === key);
  }

  /** A spare page that isn't showing any of the given months (so it can be reused). */
  private reusable(keep: number[]): HighlighterCalendar | undefined {
    const keys = new Set(keep.map(keyOf));
    return this.pages.find((c) => c.parentElement === this.$pool && !keys.has(c.month));
  }

  /** The months worth having ready around the open spread: the next sheet's two sides and the previous sheet's. */
  private get neighbours(): number[] {
    return [this.m + 2, this.m + 3, this.m - 1, this.m - 2];
  }

  /** A page showing month k, from the spares: normally prepared already; drawn now only if it wasn't. */
  private take(k: number): HighlighterCalendar {
    const el =
      this.spareFor(k) ??
      this.reusable(this.neighbours.filter((x) => x !== k)) ??
      this.pages.find((c) => c.parentElement === this.$pool)!;
    this.setMonth(el, k);
    return el;
  }

  /**
   * A page has landed (or the book was opened): after a short pause, prepare the pages around the spread one at a time in
   * idle slices, then let the right page's corner relax into its resting curl.
   */
  private afterLanding(delay: number): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.prepareThenRest(), delay);
  }

  private prepareThenRest(): void {
    this.settleTimer = 0;
    if (this.flip || this.settling || this.gesture || this.wheel || !this.isConnected) return;
    const need = this.neighbours;
    for (const k of need) {
      if (this.spareFor(k)) continue;
      const el = this.reusable(need);
      if (!el) break;
      this.setMonth(el, k);
      this.settleTimer = window.setTimeout(() => this.prepareThenRest(), PREPARE_SLICE_MS);
      return;
    }
    this.rest();
  }

  // ---------- The resting corner ----------

  /**
   * At rest the right page's bottom corner is the actual sheet, peeled back a little and slowly breathing. Every turn
   * (click, drag, swipe, bookmark) starts from this same corner, so the paper is one continuous sheet throughout.
   */
  private rest(): void {
    if (this.flip || this.settling || this.gesture || this.wheel || this.queue.length || !this.isConnected || !this.canFlip(1)) return;
    if (!this.$right.offsetWidth) return;
    this.beginFlip(1, false);
    this.flip!.idle = true;
    this.peel = 0;
    this.peelV = 0;
    this.startIdle();
  }

  private startIdle(): void {
    this.lastIdle = 0;
    if (!this.idleRaf) this.idleRaf = requestAnimationFrame(this.idleTick);
  }

  /** How far the resting corner wants to be peeled back right now: breathing, lifted further under the pointer or for a hint. */
  private peelTarget(now: number): number {
    let target = this.peelHover ? 120 : 72 + 12 * Math.sin(((now / 1000) * 2 * Math.PI) / 3.6);
    const since = (now - this.hintAt) / 1000;
    if (since >= 0 && since < 1.6) target += 60 * Math.sin(Math.min(1, since / 0.5) * Math.PI * 0.5) * Math.exp(-since * 2.2);
    return target;
  }

  private restPoint(f: Flip): Pt {
    const C = this.corner(f);
    const p = this.peelTarget(performance.now());
    return this.constrain(f, { x: C.x - p, y: C.y - p * 0.72 });
  }

  /** Pointing near the resting corner peels it back further, inviting a pull. */
  private hover(x: number, y: number): void {
    const r = this.$right.getBoundingClientRect();
    this.peelHover = Math.hypot(r.right - x, r.bottom - y) < 110;
  }

  private idleTick = (now: number): void => {
    this.idleRaf = 0;
    const f = this.flip;
    if (!f?.idle) return;
    // Hidden (e.g. the date field is closed): don't burn frames, check again later
    const visible = this.$book.checkVisibility ? this.$book.checkVisibility({ visibilityProperty: true }) : true;
    if (!visible) {
      this.lastIdle = 0;
      window.setTimeout(() => {
        if (!this.idleRaf && this.flip?.idle) this.idleRaf = requestAnimationFrame(this.idleTick);
      }, 400);
      return;
    }
    const dt = this.lastIdle ? Math.min(0.05, (now - this.lastIdle) / 1000) : 1 / 60;
    this.lastIdle = now;
    const target = this.peelTarget(now);
    const w = PEEL_OMEGA;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.peelV += (w * w * (target - this.peel) - 2 * w * this.peelV) * h;
      this.peel += this.peelV * h;
    }
    const C = this.corner(f);
    f.P = this.constrain(f, { x: C.x - this.peel, y: C.y - this.peel * 0.72 });
    this.render();
    this.idleRaf = requestAnimationFrame(this.idleTick);
  };

  /** Hand the resting corner over to a real turn: it keeps its position, it just stops breathing. */
  private takeIdle(): Flip | null {
    const f = this.flip;
    if (!f?.idle) return null;
    cancelAnimationFrame(this.idleRaf);
    this.idleRaf = 0;
    f.idle = false;
    return f;
  }

  /** Drop the resting corner straight away (only used before a jump to another month). */
  private stopIdle(): void {
    if (this.takeIdle()) this.finishFlip(false);
  }

  // ---------- Turning ----------

  private request(dir: 1 | -1, fast = false): void {
    const f = this.flip;
    if (f && !f.idle) {
      this.queue.push(dir);
      this.hurry(dir);
      return;
    }
    if (!this.canFlip(dir)) return;
    clearTimeout(this.settleTimer);
    const riffle = fast && this.queue.length > 0;
    if (f?.idle) {
      this.takeIdle();
      if (dir > 0) {
        // Keep pulling the corner that is already peeled back
        this.renderTabs(this.m + 2, false, true);
        if (riffle) {
          this.move('turn', { speed: RIFFLE_SPEED, accel: RIFFLE_ACCEL, v0: 0 });
          this.prefetch(1);
        } else this.move('turn');
        return;
      }
      // Turning back: the left page turns straight away while the peeled corner drops back flat
      this.backOverCorner(f);
      if (riffle) {
        this.move('turn', { speed: RIFFLE_SPEED, accel: RIFFLE_ACCEL, v0: 0 });
        this.prefetch(-1);
      } else this.move('turn');
      return;
    }
    this.beginFlip(dir, false);
    this.renderTabs(this.m + 2 * dir, false, true);
    if (riffle) {
      this.move('turn', { speed: RIFFLE_SPEED, accel: RIFFLE_ACCEL, v0: 0 });
      this.prefetch(dir);
    } else this.move('turn');
  }

  /**
   * Turn the left page back while the right page's corner rests peeled: the corner drops back flat by itself (drawn with the
   * other leaf) and at the same moment the left page lifts, so a hand can take hold of it straight away, like the right one.
   */
  private backOverCorner(f: Flip, top = false): void {
    this.settleAway(f);
    this.beginFlip(-1, top, this.leaves[1]);
    this.renderTabs(this.m - 2, false, true);
  }

  /** A sheet drops back flat on its own (quickly, no bounce) and lies down, while the other page goes on turning. */
  private settleAway(f: Flip): void {
    if (this.flip === f) this.flip = null;
    this.settling = f;
    f.idle = false;
    f.motion = null;
    const from = { ...f.P };
    const C = this.corner(f);
    const dist = Math.max(1, len(sub(C, from)));
    const w = CLEAR_OMEGA;
    let s = 0;
    let v = 0;
    let last = 0;
    const step = (now: number) => {
      this.settleRaf = 0;
      if (this.settling !== f) return;
      const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 1 / 60;
      last = now;
      const n = Math.max(1, Math.ceil(dt * 240));
      for (let i = 0; i < n; i++) {
        v += (w * w * (1 - s) - 2 * w * v) * (dt / n);
        s += v * (dt / n);
      }
      const down = (1 - s) * dist < LAND_PX && Math.abs(v) * dist < LAND_PX_S;
      f.P = down ? { ...C } : { x: from.x + (C.x - from.x) * s, y: from.y + (C.y - from.y) * s };
      this.render(f);
      if (down) this.finishFlip(false, f);
      else this.settleRaf = requestAnimationFrame(step);
    };
    this.settleRaf = requestAnimationFrame(step);
  }

  /**
   * Another turn has been asked for while a page is turning in the same direction: let this one fly over at riffle speed
   * instead of settling slowly, so the next one can follow straight away.
   */
  private hurry(dir: 1 | -1): void {
    const m = this.flip?.motion;
    if (!m || m.kind !== 'turn' || this.flip!.dir !== dir || m.speed > 0) return;
    m.speed = RIFFLE_SPEED;
    m.accel = RIFFLE_ACCEL * 2;
  }

  /** While riffling, prepare the pages the next turn will need, in idle time between frames. */
  private prefetch(dir: 1 | -1): void {
    const next = this.m + 2 * dir;
    const want = dir > 0 ? [next + 2, next + 3] : [next - 1, next - 2];
    const step = () => {
      if (!this.flip || this.flip.idle) return;
      for (const k of want) {
        if (this.spareFor(k)) continue;
        const el = this.reusable(want);
        if (!el) return;
        this.setMonth(el, k);
        whenIdle(step);
        return;
      }
    };
    whenIdle(step);
  }

  /**
   * Start turning a page. Forward: the right-hand sheet (this side m+1, other side m+2) lifts at the corner and turns left, revealing m+3 below;
   * backward: the left-hand sheet (this side m, other side m-1) turns back to the right, revealing m-2 on the left.
   */
  private beginFlip(dir: 1 | -1, top = false, leaf = this.leaves[0]): void {
    const W = this.$right.offsetWidth;
    const H = this.$right.offsetHeight;
    const { front, back, margin } = leaf;
    for (const el of [front, back, margin]) {
      el.style.width = `${W}px`;
      el.style.height = `${H}px`;
      el.style.transform = 'none';
      el.style.clipPath = '';
    }
    margin.style.clipPath = polyCss([]);
    // The front sits where its page was; the back is laid out like the opposite page and mirrored over during the turn
    const [fl, bl] = dir > 0 ? [W + SPINE, 0] : [0, W + SPINE];
    front.style.left = `${fl}px`;
    back.style.left = `${bl}px`;
    margin.style.left = `${bl}px`;
    for (const [el, near] of [[front, dir > 0], [back, dir < 0], [margin, dir < 0]] as const) {
      el.classList.toggle('shape-r', near);
      el.classList.toggle('shape-l', !near);
      el.classList.add('on');
    }
    const left = this.holder(this.$left).firstElementChild as HighlighterCalendar;
    const right = this.holder(this.$right).firstElementChild as HighlighterCalendar;
    if (dir > 0) {
      this.holder(front).append(right);
      this.holder(back).append(this.take(this.m + 2));
      this.holder(this.$right).append(this.take(this.m + 3));
    } else {
      // Backward: the left page (m) stays in place, and what folds over to show is its other side (m-1)
      this.holder(front).append(left);
      this.holder(back).append(this.take(this.m - 1));
      this.holder(this.$left).append(this.take(this.m - 2));
    }
    (dir > 0 ? this.$right : this.$left).classList.add('under');
    this.flip = { dir, top, P: { x: W, y: top ? 0 : H }, motion: null, leaf };
    this.flip.P = this.corner(this.flip);
    this.render();
  }

  /** Finish the turn (done=true) or fall back into place. */
  private finishFlip(done: boolean, f: Flip | null = this.flip): void {
    if (!f) return;
    // The other sheet, still dropping back flat, lies down first: this one is about to rearrange the pages
    if (f === this.flip && this.settling) this.finishFlip(false, this.settling);
    const L = f.leaf;
    const front = this.holder(L.front).firstElementChild as HighlighterCalendar;
    const back = this.holder(L.back).firstElementChild as HighlighterCalendar;
    if (f.dir > 0) {
      if (done) {
        const oldLeft = this.holder(this.$left).firstElementChild as HighlighterCalendar;
        this.holder(this.$left).append(back);
        this.$pool.append(oldLeft, front);
        this.m += 2;
      } else {
        const under = this.holder(this.$right).firstElementChild as HighlighterCalendar;
        this.holder(this.$right).append(front);
        this.$pool.append(under, back);
      }
    } else {
      if (done) {
        const oldRight = this.holder(this.$right).firstElementChild as HighlighterCalendar;
        this.holder(this.$right).append(back);
        this.$pool.append(oldRight, front);
        this.m -= 2;
      } else {
        const under = this.holder(this.$left).firstElementChild as HighlighterCalendar;
        this.holder(this.$left).append(front);
        this.$pool.append(under, back);
      }
    }
    if (f === this.settling) {
      cancelAnimationFrame(this.settleRaf);
      this.settleRaf = 0;
      this.settling = null;
    } else this.flip = null;
    L.overA.style.clipPath = polyCss([]);
    L.overB.style.clipPath = polyCss([]);
    L.margin.style.clipPath = polyCss([]);
    (L.back.parentElement as HTMLElement).style.filter = '';
    for (const el of [L.front, L.back, L.margin]) el.classList.remove('on');
    const page = f.dir > 0 ? this.$right : this.$left;
    page.classList.remove('under');
    for (const el of [L.front, L.back, L.margin, page]) (el.querySelector(':scope > .fx > .strip') as HTMLElement).style.visibility = 'hidden';
    this.layout();
    if (done) this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  /** Page width and height. */
  private get size(): { W: number; H: number } {
    return { W: this.$right.offsetWidth || 1, H: this.$right.offsetHeight || 1 };
  }

  /** The lifted page corner (mirrored coordinates: the origin is on the coil's axis, level with the top of the page). */
  private corner(f: Flip): Pt {
    const { W, H } = this.size;
    return { x: HALF + W, y: f.top ? 0 : H };
  }

  /** How far the page has turned, 0..1: the corner travels from home (x=R) round the coil to the other side (x=-R). */
  private progress(f: Flip): number {
    const R = HALF + this.size.W;
    return clamp01((R - f.P.x) / (2 * R));
  }

  /**
   * The corner can't be pulled too far from the coil (the sheet hangs on it): no further than its reach from the coil
   * at the same end, and no further than the diagonal from the other end.
   */
  private constrain(f: Flip, P: Pt): Pt {
    const { H } = this.size;
    const W = HALF + this.size.W;
    const near: Pt = { x: 0, y: f.top ? 0 : H };
    const far: Pt = { x: 0, y: f.top ? H : 0 };
    let q = P;
    const d1 = len(sub(q, near));
    if (d1 > W) q = { x: near.x + ((q.x - near.x) * W) / d1, y: near.y + ((q.y - near.y) * W) / d1 };
    const diag = Math.hypot(W, H);
    const d2 = len(sub(q, far));
    if (d2 > diag) q = { x: far.x + ((q.x - far.x) * diag) / d2, y: far.y + ((q.y - far.y) * diag) / d2 };
    return q;
  }

  /**
   * Let go of the sheet: it carries on from where it is, with the speed it had (vP: the corner's x speed in px/s),
   * to the far side ('turn'), back into the resting curl ('rest') or back down flat ('back').
   */
  private move(
    kind: Motion['kind'],
    o: { vP?: number; v0?: number; omega?: number; speed?: number; accel?: number } = {},
  ): void {
    const f = this.flip!;
    const { H } = this.size;
    const C = this.corner(f);
    const to = kind === 'turn' ? { x: -C.x, y: C.y } : kind === 'rest' ? this.restPoint(f) : C;
    const from = { ...f.P };
    const d = sub(to, from);
    const omega = o.omega ?? (kind === 'turn' ? TURN_OMEGA : SETTLE_OMEGA);
    // The speed it already has: the finger's (vP, px/s along x), or the previous page's when riffling
    let v = o.v0 ?? 0;
    if (o.vP !== undefined && Math.abs(d.x) > 1) v = o.vP / d.x;
    // Never faster than the spring can absorb without overshooting: the page stops exactly, no bounce
    v = Math.max(-1, Math.min(omega * 0.85, v));
    // The farther it travels the higher it arcs; lifted from a bottom corner it arcs up, from a top corner it arcs down
    const lift = (f.top ? 1 : -1) * LIFT * H * Math.min(1, Math.abs(d.x) / (2 * C.x));
    // Start the pull where it exactly balances the damping: no sudden push or brake at the moment it is let go
    const g = Math.min(1, Math.max(0, (2 * v) / omega));
    const dist = Math.max(1, len(d) + Math.abs(lift));
    f.motion = { from, to, lift, s: 0, v, g, omega, speed: o.speed ?? 0, accel: o.accel ?? 0, dist, kind };
    this.lastT = 0;
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  /** The point at s along a motion's path; the arc rises and falls with zero slope at both ends, so it never kinks. */
  private pathPoint(m: Motion, s: number): Pt {
    return {
      x: m.from.x + (m.to.x - m.from.x) * s,
      y: m.from.y + (m.to.y - m.from.y) * s + m.lift * Math.sin(Math.PI * Math.min(1, s)) ** 2,
    };
  }

  private loop = (now: number): void => {
    this.raf = 0;
    const f = this.flip;
    const m = f?.motion;
    if (!f || !m) return;
    const dt = this.lastT ? Math.min(1 / 30, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    if (m.speed > 0) {
      // Riffling: speed up to a steady pace (never slowing down a page that is already faster)
      if (m.v < m.speed) m.v = Math.min(m.speed, m.v + m.accel * dt);
      m.s += m.v * dt;
    } else {
      // Small fixed steps keep the spring exact on any frame rate, even when a frame comes late
      const w = m.omega;
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        m.g += (1 - m.g) * w * h;
        m.v += (w * w * (m.g - m.s) - 2 * w * m.v) * h;
        m.s += m.v * h;
      }
    }
    // Settling into the resting curl: aim at where the breathing corner is now, so it is caught up exactly, not left to drift after
    if (m.kind === 'rest') m.to = this.restPoint(f);
    // A turned page that is all but flat (and the last of a riffle): the bookmarks come back now, not after the spring's last fraction of a pixel
    if (m.kind === 'turn' && !m.landed && !this.queue.length && (1 - m.s) * m.dist < 4) {
      m.landed = true;
      this.renderTabs(this.m + 2 * f.dir);
    }
    const arrived =
      m.speed > 0 ? m.s >= 1 : m.s >= 1 || (Math.abs(1 - m.s) * m.dist < LAND_PX && Math.abs(m.v) * m.dist < LAND_PX_S);
    f.P = this.constrain(f, this.pathPoint(m, arrived ? 1 : m.s));
    this.render();
    if (!arrived) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    f.motion = null;
    this.arrive(f, m);
  };

  private arrive(f: Flip, m: Motion): void {
    if (m.kind === 'rest') {
      // A turn was asked for while the page was settling: carry on from here
      const dir = this.queue[0];
      if (dir > 0) {
        this.queue.shift();
        this.renderTabs(this.m + 2, false, true);
        this.move('turn');
        return;
      }
      if (dir < 0) {
        this.queue.shift();
        this.backOverCorner(f);
        this.move('turn');
        return;
      }
      // Settled into the resting curl: carry on breathing from exactly here, and any bookmarks hidden for the turn come back
      this.renderTabs();
      f.idle = true;
      this.peel = this.corner(f).x - f.P.x;
      this.peelV = 0;
      this.startIdle();
      return;
    }
    this.finishFlip(m.kind === 'turn');
    // Queued turns: riffle page after page, carrying the speed over from one page to the next
    const carry = m.speed > 0 ? m.v : 0;
    while (this.queue.length) {
      const dir = this.queue.shift()!;
      if (!this.canFlip(dir)) continue;
      this.beginFlip(dir, false);
      this.renderTabs(this.m + 2 * dir, false, true);
      if (this.queue.length) {
        this.move('turn', { speed: RIFFLE_SPEED, v0: carry, accel: RIFFLE_ACCEL });
        this.prefetch(dir);
      } else {
        // The last one: keeps the riffle's speed and settles softly
        this.move('turn', { v0: carry });
      }
      return;
    }
    this.afterLanding(m.kind === 'turn' ? LAND_PAUSE_MS : 120);
  }

  /**
   * How a sheet bends as it turns. It hangs on the coil, so it cannot simply fold flat across the spine: the part still on
   * its own side (the inner part, from the binding to the bend) swings up round the coil, its column of holes riding along
   * the wire, while the part beyond the bend (the outer part, with the corner) folds back over it, lying level, back up.
   * Q is where the corner would be if the sheet were folded flat; the bend is the perpendicular bisector of the corner and
   * Q (how far it may slant is solve()'s business), and how far the inner part has swung up follows from how close the bend
   * has come to the binding. Both parts are flat, so each maps onto the screen by one affine transform (and is drawn by one
   * element), and both know their height.
   */
  private bend(Q: Pt, C: Pt, W: number, H: number): Bend | null {
    if (len(sub(C, Q)) < 0.5) return null;
    const { n, k } = creaseOf(Q, C, H);
    const rect: Pt[] = [
      { x: HALF, y: 0 },
      { x: HALF + W, y: 0 },
      { x: HALF + W, y: H },
      { x: HALF, y: H },
    ];
    const keep = clipPoly(rect, (q) => k - dot(n, q));
    const fold = clipPoly(rect, (q) => dot(n, q) - k);
    const widest = keep.reduce((m, q) => Math.max(m, q.x), 0);
    const mid = Math.abs(n.x) > 1e-6 ? (k - n.y * (H / 2)) / n.x : widest;
    const alpha = this.lean(Math.min(widest, Math.max(0, mid)), widest, W);
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    // The holes ride up over the top of the wire, from the right page's side of it to the left page's: that sets how high
    // the inner part is (seen from above it swings about the spine, so the corner lands exactly as the sheet lies flat)
    const ang = WIRE_A0 + (Math.PI - 2 * WIRE_A0) * (alpha / Math.PI);
    const hz = WIRE_Z + WIRE_R * Math.sin(ang);
    // Inner part: x' = u·cos α, height hz + (u − hole)·sin α. Outer part: folded back over the inner one at the bend by
    // π − α (so it lies level), which on the screen is one more affine map of the sheet
    const k1 = n.x * ca * (1 + ca) + sa * sa;
    const k2 = 1 + ca;
    return {
      alpha,
      ca,
      sa,
      n,
      k,
      keep,
      fold,
      inner: [ca, 0, 0, 1, 0, 0],
      outer: [ca - n.x * k1, -n.x * n.y * k2, -n.y * k1, 1 - n.y * n.y * k2, k * k1, k * n.y * k2],
      innerZ: (q) => hz + (q.x - HOLE_U) * sa,
      outerZ: (q) => hz + (q.x - HOLE_U) * sa + (dot(n, q) - k) * sa * (ca * (1 - n.x) - n.x),
    };
  }

  /**
   * How far the inner part has swung up round the coil (0 lying on its own page, π on the other) when the bend is e from
   * the binding. It stays down while only the corner curls, rises as the bend nears the binding, stands upright when just
   * the blank margin is left on its own side and lies down on the other side as the bend reaches the binding.
   */
  private lean(e: number, widest: number, W: number): number {
    const e1 = 0.9 * (HALF + W);
    const e2 = HALF + MARGIN_INNER;
    const blank = e2 + 14;
    const s = clamp01(1 - e / e1);
    const s2 = 1 - e2 / e1;
    let g: number;
    if (s <= s2) g = 0.5 * (s / s2) ** 2;
    else {
      const x = (s - s2) / (1 - s2);
      const m0 = (1 - s2) / s2;
      g = 0.5 * (2 * x ** 3 - 3 * x ** 2 + 1) + m0 * (x ** 3 - 2 * x ** 2 + x) + (3 * x ** 2 - 2 * x ** 3);
    }
    // Past upright the inner part shows its back, where only the blank margin is printed: not while more than that is on that side
    g = Math.min(g, 0.5 + 0.5 * clamp01((blank - widest) / (blank - e2)));
    return Math.PI * g;
  }

  /**
   * How the sheet must bend for its corner to show exactly at P, where the hand (or the spring) has it: a few Newton steps
   * from the last answer, so the corner stays under the finger whatever the paper does on the way.
   *
   * Where the paper can't follow (a corner held up high as the sheet comes down onto the coil, where the bend has to
   * straighten out along the binding) the bend slants as far as the coil lets it, and the sheet goes on turning with the
   * hand: the corner keeps level with it across the page and slides down towards where it will land, rather than
   * stopping short and dropping flat later. The answer only ever moves as far as the hand does, so nothing drawn from it
   * (the curl's light and shadows) can jump about from one frame to the next.
   */
  private solve(f: Flip, C: Pt, W: number, H: number): Pt {
    // The corner can be pulled into the page, not out past the edge it lies on
    const P = { x: f.P.x, y: C.y > 0 ? Math.min(f.P.y, C.y) : Math.max(f.P.y, C.y) };
    if (len(sub(P, C)) < 0.5) return (f.Q = { ...P });
    const at = (q: Pt): Pt => {
      const b = this.bend(q, C, W, H);
      return b ? ap(b.outer, C) : q;
    };
    const ok = (q: Pt) => slantOk(q, C, H);
    // Start from last frame's answer; right at the corner the bend has no direction yet, so start from P (a small
    // curl barely lifts the sheet, so there the two are nearly the same)
    const Q0 = f.Q && len(sub(f.Q, C)) > 1 ? f.Q : { ...P };
    let Q = Q0;
    if (!ok(Q)) {
      const c = creaseOf(Q, C, H);
      Q = c.n.x > LEVEL ? slantQ(c.mid, Math.sign(c.n.y) || 1, C, H) : { x: C.x - 1, y: C.y };
    }
    for (let i = 0; i < 16; i++) {
      const r = at(Q);
      const ex = r.x - P.x;
      const ey = r.y - P.y;
      if (Math.abs(ex) + Math.abs(ey) < 0.005) break;
      const rx = at({ x: Q.x + 0.5, y: Q.y });
      const ry = at({ x: Q.x, y: Q.y + 0.5 });
      const a = (rx.x - r.x) * 2;
      const b = (ry.x - r.x) * 2;
      const c = (rx.y - r.y) * 2;
      const d = (ry.y - r.y) * 2;
      // Damped Gauss-Newton
      const lam = 1e-4 * (a * a + b * b + c * c + d * d) + 1e-9;
      const m11 = a * a + c * c + lam;
      const m12 = a * b + c * d;
      const m22 = b * b + d * d + lam;
      const g1 = a * ex + c * ey;
      const g2 = b * ex + d * ey;
      const det = m11 * m22 - m12 * m12;
      if (Math.abs(det) < 1e-12) break;
      let dx = -(m22 * g1 - m12 * g2) / det;
      let dy = -(m11 * g2 - m12 * g1) / det;
      const m = Math.hypot(dx, dy);
      if (m > 80) {
        dx *= 80 / m;
        dy *= 80 / m;
      }
      if (ok({ x: Q.x + dx, y: Q.y + dy })) {
        Q = { x: Q.x + dx, y: Q.y + dy };
        continue;
      }
      // That would slant the bend more than the coil lets it this near the binding: go only as far as the limit...
      let lo = 0;
      let hi = 1;
      for (let j = 0; j < 12; j++) {
        const t = (lo + hi) / 2;
        if (ok({ x: Q.x + dx * t, y: Q.y + dy * t })) lo = t;
        else hi = t;
      }
      const edge = { x: Q.x + dx * lo, y: Q.y + dy * lo };
      const ce = creaseOf(edge, C, H);
      if (!(ce.n.x > LEVEL && slantLimit(ce.mid, H) < LEVEL_TAN)) {
        Q = edge;
        continue;
      }
      // ...and slide along it, to where the corner is level with the hand across the page (no further out than the limit
      // reaches: beyond that the next step finds the way)
      const side = Math.sign(ce.n.y) || 1;
      let mid = ce.mid;
      for (let j = 0; j < 12; j++) {
        const x0 = at(slantQ(mid, side, C, H)).x - P.x;
        const x1 = at(slantQ(mid + 0.25, side, C, H)).x - P.x;
        const slope = (x1 - x0) / 0.25;
        if (!(Math.abs(slope) > 1e-6)) break;
        const step = Math.max(-60, Math.min(60, x0 / slope));
        const next = Math.max(-5, Math.min(C.x, mid - step));
        if (slantLimit(next, H) >= LEVEL_TAN) break;
        mid = next;
        if (Math.abs(step) < 1e-4) break;
      }
      const Qs = slantQ(mid, side, C, H);
      const moved = len(sub(Qs, Q));
      Q = Qs;
      if (moved < 1e-3) break;
    }
    if (!(Number.isFinite(Q.x) && Number.isFinite(Q.y))) Q = Q0;
    f.Q = Q;
    return Q;
  }

  /**
   * Draw the sheet as it bends: its inner part (this side up until it stands upright, then its blank back), its outer part
   * folded over (back up), the light on each, the shadow it casts, and who covers whom at the spine.
   */
  private render(f = this.flip): void {
    if (!f) return;
    const { front, back, margin, frontTint, marginTint, backTint, overA, overACoil, overB, overBCoil } = f.leaf;
    const { W, H } = this.size;
    const C = { x: HALF + W, y: f.top ? 0 : H };
    // Mirrored coordinates → the spread: the coil's axis is at X0, and turning back mirrors left and right
    const X0 = W + HALF;
    const mir = (x: number) => (f.dir > 0 ? x : -x);
    const sx = (x: number) => X0 + mir(x);
    // Where this side of the sheet is laid out in the spread, and where its other side is (like the facing page)
    const fl = f.dir > 0 ? W + SPINE : 0;
    const bl = f.dir > 0 ? 0 : W + SPINE;
    const toFront = (q: Pt): Pt => ({ x: sx(q.x) - fl, y: q.y });
    const toBack = (q: Pt): Pt => ({ x: sx(-q.x) - bl, y: q.y });
    const toSpine = (p: Pt): Pt => ({ x: sx(p.x) - (X0 - 28), y: p.y + ROOM_TOP });
    const Q = this.solve(f, C, W, H);
    const b = this.bend(Q, C, W, H);
    const flap = back.parentElement as HTMLElement;
    if (!b) {
      // Not lifted (yet / any more): the sheet lies flat on its page, the coil through its holes
      front.style.transform = 'none';
      front.style.clipPath = '';
      margin.style.clipPath = polyCss([]);
      back.style.clipPath = polyCss([]);
      overA.style.clipPath = polyCss([{ x: HALF, y: -ROOM_TOP }, { x: HALF + W, y: -ROOM_TOP }, { x: HALF + W, y: H + ROOM_BOTTOM }, { x: HALF, y: H + ROOM_BOTTOM }].map(toSpine));
      overACoil.style.clipPath = '';
      overB.style.clipPath = polyCss([]);
      for (const t of [frontTint, marginTint, backTint]) t.style.background = 'transparent';
      flap.style.filter = '';
      for (const el of [front, back, margin, f.dir > 0 ? this.$right : this.$left]) {
        (el.querySelector(':scope > .fx > .strip') as HTMLElement).style.visibility = 'hidden';
      }
      return;
    }
    const { ca, sa, n, k, keep, fold, inner, outer } = b;
    const up = ca >= 0;

    // Each side is one element; its own coordinates → sheet (this side, or mirrored for the other side) → screen
    const place = (el: HTMLElement, left: number, back: boolean, m: Aff) => {
      const at = (l: Pt): Pt => {
        const u = mir(left + l.x - X0);
        const r = ap(m, { x: back ? -u : u, y: l.y });
        return { x: sx(r.x), y: r.y };
      };
      const o = at({ x: 0, y: 0 });
      const ex = sub(at({ x: 1, y: 0 }), o);
      const ey = sub(at({ x: 0, y: 1 }), o);
      el.style.transform = `matrix(${ex.x}, ${ex.y}, ${ey.x}, ${ey.y}, ${o.x - left}, ${o.y})`;
    };
    place(front, fl, false, inner);
    front.style.clipPath = up ? polyCss(keep.map(toFront)) : polyCss([]);
    place(margin, bl, true, inner);
    margin.style.clipPath = up ? polyCss([]) : polyCss(keep.map(toBack));
    place(back, bl, true, outer);
    back.style.clipPath = polyCss(fold.map(toBack));

    // Light: each part is lit by how it faces the light (from the upper left, a little in front)
    const L = { x: mir(LIGHT.x), y: LIGHT.y, z: LIGHT.z };
    const nIn = up ? { x: -sa, y: 0, z: ca } : { x: sa, y: 0, z: -ca };
    const nOut = { x: -ca * sa + sa * ca * n.x, y: sa * n.y, z: ca * ca + sa * sa * n.x };
    // (Paper is never darker than a soft shade: it is lit from all round, not only by the one light)
    const shade = (v: { x: number; y: number; z: number }, most: number) => {
      const lit = (v.x * L.x + v.y * L.y + v.z * L.z) / L.z;
      return lit < 1 ? `rgba(0,0,0,${Math.min(most, 0.3 * (1 - lit)).toFixed(3)})` : `rgba(255,255,255,${Math.min(0.25, 0.25 * (lit - 1)).toFixed(3)})`;
    };
    frontTint.style.background = up ? shade(nIn, 0.16) : 'transparent';
    marginTint.style.background = up ? 'transparent' : shade(nIn, 0.1);
    backTint.style.background = shade(nOut, 0.2);

    // Who is on top at the spine, by height: paper and metal are both opaque. The coil's wire arches over the spine,
    // highest along the middle. Each part of the sheet covers it where it is the higher, and it shows over the paper where
    // it is: so the inner part, rising from the coil, has the wire going into its holes, and the outer part, folded over
    // high up, covers it until it comes down onto the other page
    const wire = (x: number) => (Math.abs(x) >= COIL / 2 ? -1 : 20 * Math.sqrt(1 - ((2 * x) / COIL) ** 2));
    // The outline of where a thing stands higher than the paper over it (height z(x, y) on the screen), between y0 and
    // y1, in the spine's coordinates (shifted down by dy for an element that starts lower): one shape per stretch. Beside
    // the thing (half `body` across), within `reach` of it, lies the shadow it casts on the paper, which shows wherever the
    // paper is lower than the nearest part of it: a sheet lying under the coil still has the wire's shadow on it
    const outline = (
      h: (x: number) => number,
      z: (x: number, y: number) => number,
      y0: number,
      y1: number,
      dy: number,
      flat = false,
      body = 0,
      reach = 0,
    ): string => {
      const steps = flat ? 1 : Math.max(2, Math.ceil((y1 - y0) / 4));
      const half = (y1 - y0) / steps / 2;
      const runs: { l: Pt[]; r: Pt[] }[] = [];
      let run: { l: Pt[]; r: Pt[] } | null = null;
      const top = (x: number) => (Math.abs(x) < body ? h(x) : h(x > 0 ? Math.max(0, x - reach) : Math.min(0, x + reach)));
      for (let i = 0; i <= steps; i++) {
        const y = y0 + ((y1 - y0) * i) / steps;
        let lo = Infinity;
        let hi = -Infinity;
        for (let x = -28; x <= 28; x += 0.5) {
          if (top(x) > z(x, y)) {
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          }
        }
        if (lo > hi) {
          run = null;
          continue;
        }
        if (!run) runs.push((run = { l: [], r: [] }));
        const a = sx(lo) - (X0 - 28);
        const c = sx(hi) - (X0 - 28);
        run.l.push({ x: Math.min(a, c) - 0.25, y: y + dy });
        run.r.push({ x: Math.max(a, c) + 0.25, y: y + dy });
      }
      if (!runs.length) return polyCss([]);
      const shapes = runs.map(({ l, r }) => {
        if (l.length === 1) {
          l = [{ x: l[0].x, y: l[0].y - half }, { x: l[0].x, y: l[0].y + half }];
          r = [{ x: r[0].x, y: r[0].y - half }, { x: r[0].x, y: r[0].y + half }];
        }
        return `M${[...l, ...r.reverse()].map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('L')}Z`;
      });
      return `path('${shapes.join('')}')`;
    };
    const nearSpine = (poly: Pt[]) =>
      poly.length > 2 && Math.min(...poly.map((p) => p.x)) < 28 && Math.max(...poly.map((p) => p.x)) > -28;
    // Over the inner part (its height depends only on how far out it is)
    const innerPoly = keep.map((q) => ap(inner, q));
    if (Math.abs(ca) > 1e-3 && nearSpine(innerPoly)) {
      const zIn = (x: number) => b.innerZ({ x: (x - inner[4]) / ca, y: 0 });
      overA.style.clipPath = polyCss(innerPoly.map(toSpine));
      overACoil.style.clipPath = outline(wire, zIn, 0, H, 0, true, COIL / 2, WIRE_SHADOW);
    } else overA.style.clipPath = polyCss([]);
    // Over the outer part (tilted a little along a slanting bend: worked out slice by slice)
    const outerPoly = fold.map((q) => ap(outer, q));
    if (nearSpine(outerPoly)) {
      const back = inv(outer);
      const zOut = (x: number, y: number) => b.outerZ(ap(back, { x, y }));
      overB.style.clipPath = polyCss(outerPoly.map(toSpine));
      overBCoil.style.clipPath = outline(wire, zOut, 0, H, 0, false, COIL / 2, WIRE_SHADOW);
    } else overB.style.clipPath = polyCss([]);

    // Shading along the bend, and the shadows the lifted sheet casts
    const F = { x: (C.x + Q.x) / 2, y: (C.y + Q.y) / 2 };
    const along = { x: -n.y, y: n.x };
    const A = { x: F.x - along.x * 2000, y: F.y - along.y * 2000 };
    const B = { x: F.x + along.x * 2000, y: F.y + along.y * 2000 };
    const p = this.progress(f);
    // How strongly the paper is curled: none when flat at either end, most in the middle of a turn
    const curl = Math.sin(Math.PI * Math.min(1, p * 1.15));
    const dl = len(sub(C, Q));
    const flapW = Math.max(10, Math.min(dl / 2, W));
    // Shadows that only exist because the sheet is lifted also fade out as it lands flat
    const lifted = Math.min(1, dl / 60);
    // This side: darker near the bend where the paper curls up
    if (up) this.strip(front, toFront(A), toFront(B), toFront(Q), 26 + 30 * curl, `rgba(0,0,0,${((0.22 * curl + 0.05) * lifted).toFixed(3)}), transparent`);
    else (front.querySelector(':scope > .fx > .strip') as HTMLElement).style.visibility = 'hidden';
    // Past upright, the strip by the binding is paper rolling over the coil: lit along the top of the roll (the bend),
    // falling into soft shade down towards the coil
    if (!up) {
      const band = Math.max(2, (k - n.y * (H / 2)) / Math.max(1e-6, n.x) - HALF);
      this.strip(margin, toBack(A), toBack(B), toBack({ x: HALF, y: H / 2 }), band, 'rgba(255,255,255,0.45), rgba(255,255,255,0) 45%, rgba(0,0,0,0.1)');
    } else (margin.querySelector(':scope > .fx > .strip') as HTMLElement).style.visibility = 'hidden';
    // The folded-over part: a highlight at the top of the curl, fading darker outwards
    this.strip(
      back,
      toBack(A),
      toBack(B),
      toBack(C),
      flapW * 0.8,
      `rgba(255,255,255,${(0.28 * curl).toFixed(3)}), rgba(0,0,0,${(0.1 * curl).toFixed(3)}) 55%, transparent`,
    );
    // The folded-over part casts a shadow that grows softer and further off the higher it is
    const crease = Math.abs(n.x) > 1e-6 ? (k - n.y * (H / 2)) / n.x : HALF;
    const high = Math.max(0, b.innerZ({ x: crease, y: 0 }));
    const sh = Math.max(curl, 0.6 * lifted * (1 - p));
    flap.style.filter = `drop-shadow(${(0.08 * high).toFixed(1)}px ${(0.14 * high).toFixed(1)}px ${(7 * sh + 0.22 * high).toFixed(1)}px rgba(0, 0, 0, ${Math.min(0.3, 0.22 * sh + 0.0012 * high).toFixed(3)}))`;
    // The page below: the shadow of the lifted sheet along where the inner part now ends
    const under = f.dir > 0 ? this.$right : this.$left;
    const toUnder = (s: Pt): Pt => ({ x: sx(s.x) - fl, y: s.y });
    this.strip(
      under,
      toUnder(ap(inner, A)),
      toUnder(ap(inner, B)),
      toUnder(ap(inner, C)),
      18 + 50 * curl,
      `rgba(0,0,0,${(0.3 * Math.max(curl, 0.35 * lifted * (1 - p)) * Math.max(0, ca)).toFixed(3)}), transparent`,
    );
  }

  /** Lay a gradient along a line (a→b, local coordinates), fading out from the line towards the inside side. */
  private strip(host: HTMLElement, a: Pt, b: Pt, inside: Pt, width: number, stops: string): void {
    const el = host.querySelector(':scope > .fx > .strip') as HTMLElement;
    const d = sub(b, a);
    const l = len(d) || 1;
    const u = { x: d.x / l, y: d.y / l };
    let nrm = { x: -u.y, y: u.x };
    if (dot(sub(inside, a), nrm) < 0) nrm = { x: -nrm.x, y: -nrm.y };
    const mid = { x: (a.x + b.x) / 2 - u.x * 2000, y: (a.y + b.y) / 2 - u.y * 2000 };
    el.style.height = `${width}px`;
    el.style.background = `linear-gradient(to bottom, ${stops})`;
    el.style.transform = `matrix(${u.x}, ${u.y}, ${nrm.x}, ${nrm.y}, ${mid.x}, ${mid.y})`;
    // "inherit", not "visible": it must hide with the book when the date field closes
    el.style.visibility = 'inherit';
  }

  /** Lay out the left and right pages, page edges and bookmarks for the current m. */
  private layout(instant = false): void {
    if (this.flip) return;
    const left = this.holder(this.$left).firstElementChild as HighlighterCalendar;
    const right = this.holder(this.$right).firstElementChild as HighlighterCalendar;
    this.setMonth(left, this.m);
    this.setMonth(right, this.m + 1);
    this.$prev.disabled = !this.canFlip(-1);
    this.$next.disabled = !this.canFlip(1);

    // Page edges: show one edge line on the fore-edge for each sheet left on that side (at most 4, so it never gets thick)
    const lo = Math.max(this.range.minMonth, this.todayIndex - HORIZON);
    const hi = Math.min(this.range.maxMonth, this.todayIndex + HORIZON);
    const edges = (n: number, side: 1 | -1) => {
      const k = n <= 0 ? 0 : Math.min(4, 1 + Math.floor(n / 6));
      const parts: string[] = [];
      for (let i = 1; i <= k; i++) {
        parts.push(`${side * i * 1.5}px ${i}px 0 -1px var(--hb-paper)`, `${side * i * 1.5}px ${i}px 0 0 var(--hb-paper-edge)`);
      }
      return parts.length ? parts.join(', ') : '0 0 0 0 transparent';
    };
    this.$book.style.setProperty('--edges-left', edges(Math.ceil((this.m - lo) / 2), -1));
    this.$book.style.setProperty('--edges-right', edges(Math.ceil((hi - this.m - 1) / 2), 1));
    this.renderTabs(this.m, instant);
  }

  /**
   * Bookmarks: one for each month with selected days, showing how many days are selected (1 to 5+). With m on the left page,
   * months on the two open pages get a ribbon lying on the page, hanging from its top edge; every other month's sheet lies
   * somewhere in the stack, so its tab sticks out from the fore-edge (left: months already turned, right: months still to
   * come), from under the sheets on top of it.
   *
   * A bookmark belongs to its sheet. When a page starts turning towards a spread with m on the left (turning), the bookmarks
   * on the sheet being turned go with it (they fade as it lifts) and everything else stays where it is, the sheet passing
   * over it. When the page lies flat (or the turn is called off) everything goes to its new place: a tab slides out from
   * under the sheet it is tucked under; a ribbon on a page that has just been covered is tucked under the sheet that landed
   * on it, and its tab slides out at the fore-edge; a tab whose page has just been uncovered slides into it and becomes its
   * ribbon; and the ribbon of a page that has just landed unrolls from its top edge. While pages riffle past, whatever would
   * change waits out of sight for the last one to land.
   */
  private renderTabs(m = this.m, instant = false, turning = false): void {
    const counts = new Map<number, number>();
    for (const d of this.selection) {
      const k = monthIndex(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const W = this.$right.offsetWidth || 394;
    const H = this.$right.offsetHeight || 350;
    const spreadW = 2 * W + SPINE;
    // Golden proportions: a tab is t thick and t·φ long; a ribbon is t wide and t·φ² long, its swallowtail cut t/φ deep
    const t = 18;
    const tabW = Math.round(t * PHI);
    const ribL = Math.round(t * PHI * PHI);
    const notch = Math.round(t / PHI);
    // Tabs share the fore-edge from H/φ⁴ below the top to H/φ³ above the bottom (clear of the resting corner). Month n sits
    // frac(n·φ) of the way down: the golden-ratio sequence, which keeps any handful of bookmarks evenly spread out
    const top0 = PAD_TOP + H / PHI ** 4;
    const span = H - H / PHI ** 4 - H / PHI ** 3 - t;
    const placed: { right: boolean; top: number; level: number }[] = [];
    // The sheet starting to turn: the open page it lifts from and the page on its back
    const dir = Math.sign(m - this.m);
    const carried = (k: number) => (dir > 0 ? k === this.m + 1 || k === this.m + 2 : k === this.m || k === this.m - 1);
    // More pages still to turn after this one lands
    const riffling = !turning && !instant && this.queue.length > 0;
    for (const [k, n] of [...counts].sort((a, b) => a[0] - b[0])) {
      let el = this.marks.get(k);
      const fresh = !el;
      if (!el) {
        const mark = document.createElement('button');
        mark.type = 'button';
        mark.className = 'mark gone';
        mark.addEventListener('click', () => {
          if (!mark.classList.contains('ribbon')) this.goTo(k);
        });
        this.$book.append(mark);
        this.marks.set(k, mark);
        el = mark;
      }
      const label = n >= 5 ? '5+' : String(n);
      const name = `${keyOf(k)}: ${n} day${n === 1 ? '' : 's'} selected`;
      el.textContent = label;
      el.title = name;
      el.setAttribute('aria-label', name);
      const st = el.style;
      let g: { left: string; top: string; width: string; height: string; padding: string; radius: string; clip: string; right: boolean };
      const ribbon = k === m || k === m + 1;
      if (ribbon) {
        // Hangs from the top edge W/φ⁴ in from the outer edge, the count at the golden section of its length
        const cx = k === m ? PAD_X + W / PHI ** 4 : PAD_X + spreadW - W / PHI ** 4;
        g = {
          left: `${(cx - t / 2).toFixed(1)}px`,
          top: `${(PAD_TOP - 6).toFixed(1)}px`,
          width: `${t}px`,
          height: `${ribL}px`,
          padding: `${Math.round((ribL - notch) / PHI - 5)}px 0px 0px`,
          radius: '0px',
          clip: `polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - ${notch}px), 0 100%)`,
          right: k > m,
        };
      } else {
        const right = k > m;
        const top = top0 + (((m0Of(k) + 1) * PHI) % 1) * span;
        // Another bookmark already sits at an overlapping height on this side: this one sticks out a little further
        let level = 0;
        while (placed.some((p) => p.right === right && p.level === level && Math.abs(p.top - top) < t + 1)) level++;
        placed.push({ right, top, level });
        const out = level * Math.round(t / PHI ** 2);
        g = {
          left: `${(right ? PAD_X + spreadW - 4 + out : PAD_X - tabW + 4 - out).toFixed(1)}px`,
          top: `${top.toFixed(1)}px`,
          width: `${tabW}px`,
          height: `${t}px`,
          // The count is centred on the part that sticks out
          padding: right ? `${(t - 10) / 2}px 0px 0px 4px` : `${(t - 10) / 2}px 4px 0px 0px`,
          radius: right ? '0 6px 6px 0' : '6px 0 0 6px',
          clip: 'polygon(0 0, 100% 0, 100% 100%, 50% 100%, 0 100%)',
          right,
        };
      }
      if (turning) {
        // It goes with the sheet that is lifting; anything else stays put while the sheet is in the air
        if (!fresh && carried(k)) el.classList.add('away');
        continue;
      }
      const was = el.classList.contains('ribbon') ? 'ribbon' : el.classList.contains('edge-r') ? 'r' : el.classList.contains('edge-l') ? 'l' : '';
      const now = ribbon ? 'ribbon' : g.right ? 'r' : 'l';
      // (Compared as numbers: the style reads back "161px" for "161.0px")
      const near = (a: string, b: string) => Math.abs(parseFloat(a) - parseFloat(b)) < 0.05;
      const moved = !near(st.left, g.left) || !near(st.top, g.top) || !near(st.width, g.width) || !near(st.height, g.height);
      if (riffling) {
        // Covered, uncovered or moved on by a page that has just landed, with more to come: out of sight until the last
        if (moved || was !== now) {
          st.transition = 'none';
          el.classList.add('away');
          void el.offsetWidth;
          st.transition = '';
        }
        continue;
      }
      const hidden = fresh || el.classList.contains('away') || el.classList.contains('gone');
      const place = (left: string, clip: string) => {
        st.left = left;
        st.top = g.top;
        st.width = g.width;
        st.height = g.height;
        st.padding = g.padding;
        st.borderRadius = g.radius;
        st.clipPath = clip;
        el!.classList.toggle('ribbon', ribbon);
        el!.classList.toggle('edge-r', !ribbon && g.right);
        el!.classList.toggle('edge-l', !ribbon && !g.right);
        el!.tabIndex = ribbon ? -1 : 0;
      };
      if (instant) {
        // The whole book jumped to another month: put it in place, fading in if it is new
        st.transition = 'none';
        place(g.left, g.clip);
        el.classList.remove('away');
        void el.offsetWidth;
        st.transition = '';
        if (hidden) requestAnimationFrame(() => el!.classList.remove('gone'));
        continue;
      }
      if (hidden || (was === 'ribbon' && !ribbon) || (was !== 'ribbon' && !ribbon && was !== now)) {
        // Coming in where it now belongs. A tab starts tucked under the sheet over it and slides out from under its edge (a
        // ribbon just covered by the sheet that landed on its page is under that sheet already); a ribbon unrolls from the
        // top of its page
        st.transition = 'none';
        if (ribbon) place(g.left, `polygon(0 0, 100% 0, 100% 0, 50% 0, 0 0)`);
        else place(`${(g.right ? PAD_X + spreadW - tabW - 2 : PAD_X + 2).toFixed(1)}px`, g.clip);
        el.classList.remove('away', 'gone');
        void el.offsetWidth;
        st.transition = '';
        place(g.left, g.clip);
        continue;
      }
      // A tab whose page has just been uncovered slides into it and becomes its ribbon; a tab moving along its fore-edge slides
      if (moved || was !== now) place(g.left, g.clip);
    }
    // This month's selection was cleared: remove the bookmark after it fades out
    for (const [k, el] of this.marks) {
      if (counts.has(k)) continue;
      this.marks.delete(k);
      el.classList.add('gone');
      setTimeout(() => el.remove(), 400);
    }
  }

  /** Turn until month k is on the left or right page (flipping quickly page after page). */
  private goTo(k: number): void {
    if (this.flip && !this.flip.idle) return;
    const n = k < this.m ? -Math.ceil((this.m - k) / 2) : k > this.m + 1 ? Math.ceil((k - this.m - 1) / 2) : 0;
    if (!n) return;
    const dir: 1 | -1 = n > 0 ? 1 : -1;
    for (let i = 1; i < Math.abs(n); i++) this.queue.push(dir);
    this.request(dir, true);
  }

  // ---------- Selection ----------

  private sync(from: HighlighterCalendar): void {
    this.selection = from.value;
    for (const c of this.pages) if (c !== from) c.value = this.selection;
    this.selectionChanged();
  }

  private selectionChanged(): void {
    if (!this.flip || this.flip.idle) this.renderTabs();
  }

  /** A page changed its own month (keyboard moved out of the month): restore that page and turn one page instead of jumping. */
  private onPageMonth(c: HighlighterCalendar): void {
    if (this.flip && !this.flip.idle) return;
    const k = parseKey(c.month);
    if (k === null) return;
    const isLeft = c.parentElement === this.holder(this.$left);
    const was = isLeft ? this.m : this.m + 1;
    this.setMonth(c, was);
    if (k !== this.m && k !== this.m + 1) this.request(k > was ? 1 : -1);
  }

  // ---------- Gesture: press on blank space and drag sideways, the sheet follows the finger ----------

  /** Blank space: anywhere that isn't a day cell or a button (the page corners count as blank: they can be pulled). */
  private isBlank(e: Event): boolean {
    return !e
      .composedPath()
      .some(
        (n) =>
          n instanceof HTMLElement && (n.classList.contains('wrap') || (n.localName === 'button' && !n.classList.contains('corner'))),
      );
  }

  private onDown(e: PointerEvent): void {
    if (this.gesture || (e.pointerType === 'mouse' && e.button !== 0) || !this.isBlank(e)) return;
    const path = e.composedPath();
    // The peeled-back corner of the resting sheet, and the bit of the next page it uncovers, are part of the corner too
    const peeled = !!this.flip?.idle && (path.includes(this.flip.leaf.back) || path.includes(this.$right));
    this.gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      mode: 'idle',
      samples: [{ t: e.timeStamp, x: e.clientX }],
      origin: { x: 0, y: 0 },
      corner: path.includes(this.$next) || peeled ? 1 : path.includes(this.$prev) ? -1 : 0,
    };
    try {
      this.$book.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no real pointer
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.gesture && this.flip?.idle) this.hover(e.clientX, e.clientY);
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    g.samples.push({ t: e.timeStamp, x: e.clientX });
    while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;

    if (g.mode === 'idle') {
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) {
        g.mode = 'scroll';
        return;
      }
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const moving = this.flip && !this.flip.idle ? this.flip : null;
      if (moving) {
        const m = moving.motion;
        if (m?.kind === 'turn' && moving.dir === dir) {
          // The page is already turning this way: this counts as "turn one more page"
          g.mode = 'flick';
          this.queue.push(dir);
          this.hurry(dir);
          return;
        }
        if (!m) {
          g.mode = 'scroll';
          return;
        }
        // Catch the moving sheet: from here it follows the finger again
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        moving.motion = null;
        this.queue = [];
        g.mode = 'drag';
        g.origin = { ...moving.P };
        this.renderTabs(this.m + 2 * moving.dir, false, true);
        g.x = e.clientX;
        g.y = e.clientY;
        return;
      }
      if (!this.canFlip(dir)) {
        g.mode = 'scroll';
        return;
      }
      clearTimeout(this.settleTimer);
      const idle = this.takeIdle();
      if (idle && dir > 0) {
        // Pull the corner that is already peeled back; the paper stays one continuous sheet
        g.mode = 'drag';
        g.origin = { ...idle.P };
        this.renderTabs(this.m + 2, false, true);
      } else if (idle) {
        // Turning back: the left page lifts and follows the finger straight away, while the peeled corner drops back flat
        g.mode = 'drag';
        const r = this.$spread.getBoundingClientRect();
        this.backOverCorner(idle, g.y < r.top + r.height / 2);
        g.origin = this.corner(this.flip!);
      } else {
        g.mode = 'drag';
        // Pressing on the top half of the page lifts the top corner, the bottom half lifts the bottom corner
        const r = this.$spread.getBoundingClientRect();
        this.beginFlip(dir, g.y < r.top + r.height / 2);
        this.renderTabs(this.m + 2 * dir, false, true);
        g.origin = this.corner(this.flip!);
      }
      // Follow the finger from here on, so the sheet doesn't jump by the few pixels it took to recognise the drag
      g.x = e.clientX;
      g.y = e.clientY;
      return;
    }
    if (g.mode !== 'drag' || !this.flip) return;
    // The corner follows the finger (by how far the finger has moved, wherever it was pressed)
    const f = this.flip;
    const mdx = f.dir > 0 ? dx : -dx;
    f.P = this.constrain(f, { x: g.origin.x + mdx * 1.1, y: g.origin.y + dy * 0.6 });
    this.render();
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    if (g.mode === 'idle') {
      // A tap on a page's margin (or its corner) turns that page
      const side = !cancelled && e.timeStamp - g.t < 500 ? g.corner || this.sideAt(g.x, g.y) : 0;
      if (side > 0) this.next();
      else if (side < 0) this.prev();
      else if (!this.flip) this.afterLanding(120);
      return;
    }
    const s0 = g.samples[0];
    const vx = e.timeStamp > s0.t ? (e.clientX - s0.x) / (e.timeStamp - s0.t) : 0;
    if (g.mode !== 'drag' || !this.flip) {
      if (!this.flip) this.afterLanding(120);
      return;
    }
    // Falling back into the resting curl: settle straight into the lift it should have with the pointer where it is now
    if (e.pointerType === 'mouse') this.hover(e.clientX, e.clientY);
    else this.peelHover = false;
    this.release(!cancelled, vx);
  }

  /** Which open page a point is on: 1 the right one, -1 the left one, 0 neither. */
  private sideAt(x: number, y: number): 0 | 1 | -1 {
    const r = this.$spread.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return 0;
    return x > r.left + r.width / 2 ? 1 : -1;
  }

  /**
   * Let go after a drag or a swipe (vx: the finger's speed in px/ms). Past about a third of the way, or with a flick,
   * the page carries on over and settles flat; otherwise it falls back, into the resting curl if it is the right page's corner.
   */
  private release(allowTurn: boolean, vx: number): void {
    const f = this.flip!;
    const along = f.dir > 0 ? -vx : vx;
    const go = allowTurn && (this.progress(f) >= COMMIT || along > FLICK_SPEED) && along > -FLICK_SPEED;
    // The corner moved 1.1× as far as the finger, in mirrored coordinates
    const vP = (f.dir > 0 ? vx : -vx) * 1.1 * 1000;
    // Turning: the bookmarks that will change stay out of sight until the page lies flat. Falling back: they return when it has settled
    if (go) this.renderTabs(this.m + 2 * f.dir, false, true);
    if (go) this.move('turn', { vP });
    else this.move(f.dir > 0 && !f.top ? 'rest' : 'back', { vP });
  }

  /**
   * Trackpad two-finger swipe (Mac): sideways wheel events drive the page exactly like a drag, following the fingers
   * and momentum; when the events stop, the page carries on or falls back, as with letting go.
   */
  private onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const now = performance.now();
    const step = e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const mag = Math.abs(step);
    let w = this.wheel;
    if (!w) {
      // The momentum of the previous swipe keeps coming for a while after the fingers lift: swallow it, unless the
      // steps suddenly grow again, which means the fingers have started a new swipe
      if (now < this.wheelLock && mag < this.tailStep * 1.6 + 2) {
        this.wheelLock = now + 160;
        this.tailStep = mag;
        return;
      }
      if (this.gesture) return;
      const dir: 1 | -1 = step > 0 ? 1 : -1;
      const f = this.flip;
      if (f && !f.idle) {
        // A page is still turning: a swipe the same way turns one more, anything else waits for it to land
        if (f.motion?.kind === 'turn' && f.dir === dir) {
          this.queue.push(dir);
          this.hurry(dir);
        }
        this.lockWheel(now, mag);
        return;
      }
      if (!this.canFlip(dir)) {
        this.lockWheel(now, mag);
        return;
      }
      clearTimeout(this.settleTimer);
      const idle = this.takeIdle();
      let origin: Pt;
      if (idle && dir > 0) {
        origin = { ...idle.P };
        this.renderTabs(this.m + 2, false, true);
      } else {
        if (idle) this.backOverCorner(idle);
        else {
          this.beginFlip(dir, false);
          this.renderTabs(this.m + 2 * dir, false, true);
        }
        origin = this.corner(this.flip!);
      }
      w = this.wheel = { dir, dx: 0, origin, samples: [], timer: 0, peak: 0, last: 0, shrinking: 0, events: 0 };
    }
    w.events++;
    if (mag >= w.peak) {
      w.peak = mag;
      w.shrinking = 0;
    } else if (mag < w.last) w.shrinking++;
    else if (mag > w.last) w.shrinking = 0;
    w.last = mag;
    w.dx -= step;
    w.samples.push({ t: now, x: w.dx });
    while (w.samples.length > 2 && now - w.samples[0].t > 100) w.samples.shift();
    if (this.flip && !this.flip.motion) {
      const mdx = w.dir > 0 ? w.dx : -w.dx;
      this.flip.P = this.constrain(this.flip, { x: w.origin.x + mdx * 1.1, y: w.origin.y - Math.min(40, Math.abs(mdx) * 0.15) });
      this.render();
    }
    clearTimeout(w.timer);
    // Steps shrinking steadily means the fingers have lifted and only momentum is left: let go now, at the speed it
    // has, so the spring carries the page on smoothly instead of it trailing the momentum and then starting again
    if (w.events > 4 && w.shrinking >= 4 && mag < w.peak * 0.5) {
      this.endWheel();
      return;
    }
    w.timer = window.setTimeout(() => this.endWheel(), 140);
  }

  private lockWheel(now: number, mag: number): void {
    this.wheelLock = now + 300;
    this.tailStep = mag;
  }

  private endWheel(): void {
    const w = this.wheel;
    if (!w) return;
    clearTimeout(w.timer);
    this.wheel = null;
    this.wheelLock = performance.now() + 350;
    this.tailStep = w.last;
    const s0 = w.samples[0];
    const s1 = w.samples[w.samples.length - 1];
    const vx = s0 && s1 && s1.t > s0.t ? (s1.x - s0.x) / (s1.t - s0.t) : 0;
    const f = this.flip;
    if (!f || f.motion) {
      if (!f) this.afterLanding(120);
      return;
    }
    this.release(true, vx);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-book': HighlighterBook;
  }
}
