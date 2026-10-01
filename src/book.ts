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

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthIndex = (y: number, m0: number) => y * 12 + m0;
const m0Of = (k: number) => ((k % 12) + 12) % 12;
const keyOf = (k: number) => `${Math.floor(k / 12)}-${pad2(m0Of(k) + 1)}`;
const parseKey = (s: string): number | null => {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  return m ? monthIndex(Number(m[1]), Math.min(11, Math.max(0, Number(m[2]) - 1))) : null;
};

const STYLE = /* css */ `
:host {
  --hb-paper: #fbf8f2;
  --hb-paper-edge: #e9e3d6;
  --hb-line: rgba(60, 45, 25, 0.07);
  --hb-shadow: rgba(40, 30, 15, 0.18);
  --hb-ink: #ffd21f;
  --hc-card-width: 22rem;
  --hb-ease: cubic-bezier(0.65, 0, 0.35, 1);
  display: block;
}
/* Dark theme: follows the system unless theme="light"; theme="dark" forces it */
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --hb-paper: #2f3238;
    --hb-paper-edge: #45484f;
    --hb-line: rgba(255, 255, 255, 0.07);
    --hb-shadow: rgba(0, 0, 0, 0.45);
  }
}
:host([theme="dark"]) {
  --hb-paper: #2f3238;
  --hb-paper-edge: #45484f;
  --hb-line: rgba(255, 255, 255, 0.07);
  --hb-shadow: rgba(0, 0, 0, 0.45);
}
.book {
  position: relative;
  width: max-content;
  margin: 0 auto;
  padding: 10px 40px 30px;
  touch-action: pan-y;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
}
.spread {
  position: relative;
  display: grid;
  grid-template-columns: auto auto;
}
.page, .turn {
  position: relative;
  box-sizing: border-box;
  padding: 16px 18px 14px;
  background:
    radial-gradient(120% 90% at 50% 40%, transparent 60%, rgba(120, 90, 40, 0.05)),
    var(--hb-paper);
}
.shape-l { border-radius: 10px 2px 2px 10px; }
.shape-r { border-radius: 2px 10px 10px 2px; }
.page { transition: box-shadow 0.45s; }
.page.left { box-shadow: var(--edges-left, none), -6px 14px 28px -10px var(--hb-shadow); }
.page.right { box-shadow: var(--edges-right, none), 6px 14px 28px -10px var(--hb-shadow); }
/* The page underneath a turning (or resting, peeled) sheet: only its exposed corner shows, and grabbing it pulls the sheet */
.page.under { cursor: grab; }
.page.under highlighter-calendar { pointer-events: none; }
/* Gutter: the shadow near the binding */
.gutter {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
}
.shape-l .gutter { background: linear-gradient(to left, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.04) 5%, transparent 14%); }
.shape-r .gutter { background: linear-gradient(to right, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.04) 5%, transparent 14%); }
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
.flip-on .turn { visibility: inherit; }
.flap {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.turn.front { z-index: 4; }
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
}
/* The page corners: click (or press and pull) to turn. The right one is the real sheet, peeled back and breathing */
.corner {
  position: absolute;
  bottom: 30px;
  width: 72px;
  height: 72px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  z-index: 6;
}
.corner.next { right: 40px; }
.corner.prev { left: 40px; }
.corner[disabled] { pointer-events: none; }
/* Bookmarks: one per month, always the same element. When its page isn't open it sticks out from the fore-edge; when
   its page is open it slides into the page and becomes a swallowtail ribbon hanging from the top. Every change is animated; nothing jumps */
.mark {
  position: absolute;
  z-index: 6;
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
.mark.ribbon { cursor: default; box-shadow: none; }
.mark.edge-r:hover { translate: 3px 0; }
.mark.edge-l:hover { translate: -3px 0; }
.mark.gone { opacity: 0; pointer-events: none; }
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
  /**
   * What happens on arrival: the page has turned, it has fallen back flat, it has settled into the resting curl, or the
   * resting corner has dropped flat to make way for turning the left page back.
   */
  kind: 'turn' | 'back' | 'rest' | 'clear';
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
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  t: number;
  /** 'idle' not moved yet; 'drag' the sheet follows the finger; 'wait' the resting corner is getting out of the way before the left page lifts; 'flick' one more turn while a turn is running; 'scroll' vertical, ignored */
  mode: 'idle' | 'drag' | 'flick' | 'scroll' | 'wait';
  samples: { t: number; x: number }[];
  origin: Pt;
  /** Pressed on a page corner (or the peeled-back corner of the next sheet): a tap there turns the page. */
  corner: 1 | -1 | 0;
  /** How far (px) the finger had already moved while the resting corner was getting out of the way. */
  pre: number;
}

/** A two-finger trackpad swipe being followed. */
interface Wheel {
  dir: 1 | -1;
  dx: number;
  origin: Pt;
  /** The resting corner is still getting out of the way (turning back). */
  wait: boolean;
  /** How far (px) the fingers had already swiped by the time the left page could lift. */
  pre: number;
  samples: { t: number; x: number }[];
  timer: number;
  /** For telling the fingers apart from the momentum that follows them: the largest step so far, the last one, and how many shrank in a row. */
  peak: number;
  last: number;
  shrinking: number;
  events: number;
}

/**
 * <highlighter-book>: an open paper calendar. Two facing pages, with a month printed on each side of every sheet,
 * so two months are always open at once; pages turn along the gutter like real paper.
 *
 * - The right page's bottom corner rests slightly peeled back, breathing. It is the real sheet: click it, or pull it, and
 *   the same curl carries on into a full turn.
 * - Press on blank space (outside the day cells) and drag, or swipe sideways with two fingers on a trackpad: drag left and the
 *   right page follows your finger over; drag right and the left page turns back. Let go past about a third, or with a flick,
 *   and the page carries on and settles flat; otherwise it falls back. Quick swipes in a row riffle page after page.
 * - A month with selected days sticks a bookmark out of the fore-edge (at a different height per month); click it to jump to that month.
 * - Months already past are printed with a vignette.
 * Attributes and input / change events are the same as <highlighter-calendar>; it also has month (the left page's month) and next() / prev().
 */
export class HighlighterBook extends HTMLElement {
  static observedAttributes = ['month', 'value', ...FORWARDED];

  private $book: HTMLElement;
  private $left: HTMLElement;
  private $right: HTMLElement;
  private $spread: HTMLElement;
  private $front: HTMLElement;
  private $back: HTMLElement;
  private $pool: HTMLElement;
  /** One bookmark for each month with a selection (month index → element). */
  private marks = new Map<number, HTMLButtonElement>();
  private $prev: HTMLButtonElement;
  private $next: HTMLButtonElement;
  /** Six pages: the two open ones, plus the two either side prepared ahead of time so a turn never has to wait for one. */
  private pages: HighlighterCalendar[] = [];
  /** The left page's month (month index = year * 12 + month). The right page is m + 1. */
  private m: number;
  private flip: Flip | null = null;
  /** Page turns requested while a turn is in progress. */
  private queue: (1 | -1)[] = [];
  /** The next queued turn should play at normal speed (a single click), not riffle speed. */
  private slowNext = false;
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
          <div class="turn front"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div>
          <div class="flap"><div class="turn back"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div></div>
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
    this.$front = q('.turn.front');
    this.$back = q('.turn.back');
    this.$pool = q('.pool');
    this.$prev = q('.corner.prev');
    this.$next = q('.corner.next');

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
    this.afterLanding(300);
  }

  disconnectedCallback(): void {
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
    el.toggleAttribute('vignette', k < this.todayIndex);
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
    if (this.flip || this.gesture || this.wheel || !this.isConnected) return;
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
    if (this.flip || this.gesture || this.wheel || this.queue.length || !this.isConnected || !this.canFlip(1)) return;
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
        this.renderTabs(this.m + 2);
        if (riffle) {
          this.move('turn', { speed: RIFFLE_SPEED, accel: RIFFLE_ACCEL, v0: 0 });
          this.prefetch(1);
        } else this.move('turn');
        return;
      }
      // Turning back: the peeled corner gets out of the way first, then the left page turns
      this.clearCorner();
      this.queue.unshift(-1);
      this.slowNext = !fast;
      return;
    }
    this.beginFlip(dir, false);
    this.renderTabs(this.m + 2 * dir);
    if (riffle) {
      this.move('turn', { speed: RIFFLE_SPEED, accel: RIFFLE_ACCEL, v0: 0 });
      this.prefetch(dir);
    } else this.move('turn');
  }

  /** The resting corner drops back flat, quickly, so the left page can be turned back. */
  private clearCorner(): void {
    this.move('clear', { omega: CLEAR_OMEGA, v0: 0 });
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
  private beginFlip(dir: 1 | -1, top = false): void {
    const W = this.$right.offsetWidth;
    const H = this.$right.offsetHeight;
    for (const el of [this.$front, this.$back]) {
      el.style.width = `${W}px`;
      el.style.height = `${H}px`;
      el.style.transform = 'none';
      el.style.clipPath = '';
    }
    // The front sits where its page was; the back is laid out like the opposite page and mirrored over during the turn
    const [fl, bl] = dir > 0 ? [W, 0] : [0, W];
    this.$front.style.left = `${fl}px`;
    this.$back.style.left = `${bl}px`;
    this.$front.className = `turn front ${dir > 0 ? 'shape-r' : 'shape-l'}`;
    this.$back.className = `turn back ${dir > 0 ? 'shape-l' : 'shape-r'}`;
    const left = this.holder(this.$left).firstElementChild as HighlighterCalendar;
    const right = this.holder(this.$right).firstElementChild as HighlighterCalendar;
    if (dir > 0) {
      this.holder(this.$front).append(right);
      this.holder(this.$back).append(this.take(this.m + 2));
      this.holder(this.$right).append(this.take(this.m + 3));
    } else {
      // Backward: the left page (m) stays in place, and what folds over to show is its other side (m-1)
      this.holder(this.$front).append(left);
      this.holder(this.$back).append(this.take(this.m - 1));
      this.holder(this.$left).append(this.take(this.m - 2));
    }
    (dir > 0 ? this.$right : this.$left).classList.add('under');
    this.flip = { dir, top, P: { x: W, y: top ? 0 : H }, motion: null };
    this.flip.P = this.corner(this.flip);
    this.$spread.classList.add('flip-on');
    this.render();
  }

  /** Finish the turn (done=true) or fall back into place. */
  private finishFlip(done: boolean): void {
    const f = this.flip;
    if (!f) return;
    const front = this.holder(this.$front).firstElementChild as HighlighterCalendar;
    const back = this.holder(this.$back).firstElementChild as HighlighterCalendar;
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
    this.flip = null;
    this.$left.classList.remove('under');
    this.$right.classList.remove('under');
    this.$spread.classList.remove('flip-on');
    for (const s of this.shadowRoot!.querySelectorAll<HTMLElement>('.strip')) s.style.visibility = 'hidden';
    this.layout();
    if (done) this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  /** Page width and height. */
  private get size(): { W: number; H: number } {
    return { W: this.$right.offsetWidth || 1, H: this.$right.offsetHeight || 1 };
  }

  /** The lifted page corner (mirrored coordinates). */
  private corner(f: Flip): Pt {
    const { W, H } = this.size;
    return { x: W, y: f.top ? 0 : H };
  }

  /** How far the page has turned, 0..1: the corner travels from home (x=W) to the other side (x=-W). */
  private progress(f: Flip): number {
    const { W } = this.size;
    return clamp01((W - f.P.x) / (2 * W));
  }

  /**
   * The corner can't be pulled too far from the spine (the paper is attached to it): no more than a page width from the spine end on the same side,
   * and no more than the diagonal from the other end.
   */
  private constrain(f: Flip, P: Pt): Pt {
    const { W, H } = this.size;
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
    const { W, H } = this.size;
    const C = this.corner(f);
    const to = kind === 'turn' ? { x: -W, y: C.y } : kind === 'rest' ? this.restPoint(f) : C;
    const from = { ...f.P };
    const d = sub(to, from);
    const omega = o.omega ?? (kind === 'turn' ? TURN_OMEGA : SETTLE_OMEGA);
    // The speed it already has: the finger's (vP, px/s along x), or the previous page's when riffling
    let v = o.v0 ?? 0;
    if (o.vP !== undefined && Math.abs(d.x) > 1) v = o.vP / d.x;
    // Never faster than the spring can absorb without overshooting: the page stops exactly, no bounce
    v = Math.max(-1, Math.min(omega * 0.85, v));
    // The farther it travels the higher it arcs; lifted from a bottom corner it arcs up, from a top corner it arcs down
    const lift = (f.top ? 1 : -1) * LIFT * H * Math.min(1, Math.abs(d.x) / (2 * W));
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
        this.renderTabs(this.m + 2);
        this.move('turn');
        return;
      }
      if (dir < 0) {
        this.clearCorner();
        return;
      }
      // Settled into the resting curl: carry on breathing from exactly here
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
      const slow = this.slowNext;
      this.slowNext = false;
      this.beginFlip(dir, false);
      this.renderTabs(this.m + 2 * dir);
      if (!slow && this.queue.length) {
        this.move('turn', { speed: RIFFLE_SPEED, v0: carry, accel: RIFFLE_ACCEL });
        this.prefetch(dir);
      } else {
        // The last one: keeps the riffle's speed and settles softly
        this.move('turn', { v0: slow ? 0 : carry });
      }
      return;
    }
    this.slowNext = false;
    this.afterLanding(m.kind === 'turn' ? LAND_PAUSE_MS : 120);
  }

  /**
   * Fold the sheet according to the corner position: the front is clipped along the fold line to drop the folded part; the back (the other side of the next sheet)
   * is mirrored to the other side of the fold line and laid on top; then paint the sheet's shading along the fold line and the shadow it casts on the page below.
   */
  private render(): void {
    const f = this.flip;
    if (!f) return;
    const { W, H } = this.size;
    const C = this.corner(f);
    const P = f.P;
    const mir = (p: Pt): Pt => (f.dir > 0 ? p : { x: -p.x, y: p.y });
    const frontOx = f.dir > 0 ? 0 : -W;
    const backOx = f.dir > 0 ? -W : 0;
    const d = sub(C, P);
    const dl = len(d);
    const rect: Pt[] = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    if (dl < 0.5) {
      // Not lifted (yet / any more): the sheet lies flat
      this.$front.style.clipPath = '';
      this.$back.style.clipPath = polyCss([]);
      (this.$back.parentElement as HTMLElement).style.filter = '';
      for (const st of this.shadowRoot!.querySelectorAll<HTMLElement>('.strip')) st.style.visibility = 'hidden';
      return;
    }
    const n = { x: d.x / dl, y: d.y / dl };
    const F = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
    const side = (p: Pt) => dot(sub(p, F), n);
    const keep = clipPoly(rect, (p) => -side(p));
    const fold = clipPoly(rect, side);

    // Front: keep only the part that isn't folded
    const toFront = (q: Pt): Pt => {
      const r = mir(q);
      return { x: r.x - frontOx, y: r.y };
    };
    this.$front.style.clipPath = polyCss(keep.map(toFront));

    // Back: what's printed behind point q on the sheet is the opposite page's content at M(q); it gets folded to R(q).
    // Back element's local coordinates → screen: l → layout position → mirrored coordinates → M then R → back to real coordinates
    const reflect = (q: Pt): Pt => {
      const k = 2 * side(q);
      return { x: q.x - k * n.x, y: q.y - k * n.y };
    };
    const M = (q: Pt): Pt => ({ x: -q.x, y: q.y });
    const toScreen = (l: Pt): Pt => {
      const layout = { x: l.x + backOx, y: l.y };
      return mir(reflect(M(mir(layout))));
    };
    const o = toScreen({ x: 0, y: 0 });
    const ex = sub(toScreen({ x: 1, y: 0 }), o);
    const ey = sub(toScreen({ x: 0, y: 1 }), o);
    this.$back.style.transform = `matrix(${ex.x}, ${ex.y}, ${ey.x}, ${ey.y}, ${o.x - backOx}, ${o.y})`;
    const toBack = (q: Pt): Pt => {
      const r = mir(M(q));
      return { x: r.x - backOx, y: r.y };
    };
    this.$back.style.clipPath = polyCss(fold.map(toBack));

    // Two points on the fold line (mirrored coordinates)
    const along = { x: -n.y, y: n.x };
    const A = { x: F.x - along.x * 2000, y: F.y - along.y * 2000 };
    const B = { x: F.x + along.x * 2000, y: F.y + along.y * 2000 };
    const p = this.progress(f);
    // How strongly the paper is curled: none when flat at either end, most in the middle of a turn
    const bend = Math.sin(Math.PI * Math.min(1, p * 1.15));
    const flapW = Math.max(10, Math.min(dl / 2, W));
    // Shadows that only exist because the sheet is lifted also fade out as it lands flat
    const lifted = Math.min(1, dl / 60);

    // Front: darker near the fold line where the paper curls up
    this.strip(this.$front, toFront(A), toFront(B), toFront(P), 26 + 30 * bend, `rgba(0,0,0,${((0.22 * bend + 0.05) * lifted).toFixed(3)}), transparent`);
    // Back: a highlight at the top of the curl, fading darker outwards
    this.strip(
      this.$back,
      toBack(A),
      toBack(B),
      toBack(C),
      flapW * 0.8,
      `rgba(255,255,255,${(0.28 * bend).toFixed(3)}), rgba(0,0,0,${(0.1 * bend).toFixed(3)}) 55%, transparent`,
    );
    // The shadow of the folded-over flap also follows the curl, vanishing exactly when the turn completes
    const sh = Math.max(bend, 0.6 * lifted * (1 - p));
    (this.$back.parentElement as HTMLElement).style.filter = `drop-shadow(0 0 ${(7 * sh).toFixed(1)}px rgba(0, 0, 0, ${(0.22 * sh).toFixed(3)}))`;
    // Page below: the shadow cast by the lifted sheet, hugging the fold line and fading outwards
    const under = f.dir > 0 ? this.$right : this.$left;
    this.strip(under, toFront(A), toFront(B), toFront(C), 18 + 50 * bend, `rgba(0,0,0,${(0.3 * Math.max(bend, 0.35 * lifted * (1 - p))).toFixed(3)}), transparent`);
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
   * Bookmarks: one for each month with selected days, showing how many days are selected (1 to 5+). With m on the left page:
   * months on the two open pages get a ribbon tucked into the page, months already turned sit on the left fore-edge, months not yet reached on the right,
   * each at a different height per month. Changes of position or shape always transition smoothly.
   */
  private renderTabs(m = this.m, instant = false): void {
    const counts = new Map<number, number>();
    for (const d of this.selection) {
      const k = monthIndex(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const W = this.$right.offsetWidth || 380;
    const H = this.$right.offsetHeight || 360;
    const padX = 40;
    const padY = 10;
    const slotH = (H - 40) / 12;
    const th = Math.max(16, Math.min(22, slotH - 4));
    const used = new Map<string, number>();
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
      if (fresh || instant) st.transition = 'none';
      if (k === m || k === m + 1) {
        st.left = `${k === m ? padX + 24 : padX + 2 * W - 44}px`;
        st.top = `${padY - 5}px`;
        st.width = '20px';
        st.height = '50px';
        st.paddingTop = '26px';
        st.borderRadius = '0';
        st.clipPath = 'polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)';
        el.classList.add('ribbon');
        el.classList.remove('edge-l', 'edge-r');
        el.tabIndex = -1;
      } else {
        const right = k > m;
        // There is already a bookmark at this height on this side (the same month in a different year): stagger it a bit further out
        const spot = `${right ? 'r' : 'l'}${m0Of(k)}`;
        const extra = used.get(spot) ?? 0;
        used.set(spot, extra + 1);
        st.left = `${right ? padX + 2 * W - 4 + extra * 8 : padX - 26 - extra * 8}px`;
        st.top = `${padY + 12 + m0Of(k) * slotH}px`;
        st.width = '30px';
        st.height = `${th}px`;
        st.paddingTop = `${(th - 10) / 2}px`;
        st.borderRadius = right ? '0 6px 6px 0' : '6px 0 0 6px';
        st.clipPath = 'polygon(0 0, 100% 0, 100% 100%, 50% 100%, 0 100%)';
        el.classList.remove('ribbon');
        el.classList.toggle('edge-r', right);
        el.classList.toggle('edge-l', !right);
        el.tabIndex = 0;
      }
      if (fresh || instant) {
        // A new bookmark (or the whole book jumped to another month): place it first, then fade it in
        void el.offsetWidth;
        st.transition = '';
        requestAnimationFrame(() => el!.classList.remove('gone'));
      }
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
    const peeled = !!this.flip?.idle && (path.includes(this.$back) || path.includes(this.$right));
    this.gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      mode: 'idle',
      samples: [{ t: e.timeStamp, x: e.clientX }],
      origin: { x: 0, y: 0 },
      corner: path.includes(this.$next) || peeled ? 1 : path.includes(this.$prev) ? -1 : 0,
      pre: 0,
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
    if (g.mode === 'wait') {
      // The peeled corner is out of the way: now the left page lifts and follows the finger from here
      if (this.flip) return;
      const r = this.$spread.getBoundingClientRect();
      this.beginFlip(-1, e.clientY < r.top + r.height / 2);
      g.origin = this.corner(this.flip!);
      g.pre = Math.max(0, e.clientX - g.x);
      g.x = e.clientX;
      g.y = e.clientY;
      g.mode = 'drag';
    }
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
        if (!m || m.kind === 'clear') {
          g.mode = 'scroll';
          return;
        }
        // Catch the moving sheet: from here it follows the finger again
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        moving.motion = null;
        this.queue = [];
        this.slowNext = false;
        g.mode = 'drag';
        g.origin = { ...moving.P };
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
      } else if (idle) {
        // Turning back: the peeled corner gets out of the way first, then the left page follows the finger
        g.mode = 'wait';
        this.clearCorner();
        return;
      } else {
        g.mode = 'drag';
        // Pressing on the top half of the page lifts the top corner, the bottom half lifts the bottom corner
        const r = this.$spread.getBoundingClientRect();
        this.beginFlip(dir, g.y < r.top + r.height / 2);
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
      // A tap on a page corner turns the page
      if (!cancelled && g.corner && e.timeStamp - g.t < 500) {
        if (g.corner > 0) this.next();
        else this.prev();
      } else if (!this.flip) this.afterLanding(120);
      return;
    }
    const s0 = g.samples[0];
    const vx = e.timeStamp > s0.t ? (e.clientX - s0.x) / (e.timeStamp - s0.t) : 0;
    if (g.mode === 'wait') {
      // Let go before the left page could lift: a clear swipe still turns it back, once the corner is out of the way
      this.turnBackLater(!cancelled && (e.clientX - g.x > 40 || vx > FLICK_SPEED));
      return;
    }
    if (g.mode !== 'drag' || !this.flip) {
      if (!this.flip) this.afterLanding(120);
      return;
    }
    // Falling back into the resting curl: settle straight into the lift it should have with the pointer where it is now
    if (e.pointerType === 'mouse') this.hover(e.clientX, e.clientY);
    else this.peelHover = false;
    this.release(!cancelled, vx, g.pre);
  }

  private turnBackLater(yes: boolean): void {
    if (yes && this.flip) {
      this.queue.push(-1);
      this.slowNext = true;
    } else if (yes) this.request(-1);
    else if (!this.flip) this.afterLanding(120);
  }

  /**
   * Let go after a drag or a swipe (vx: the finger's speed in px/ms). Past about a third of the way, or with a flick,
   * the page carries on over and settles flat; otherwise it falls back, into the resting curl if it is the right page's corner.
   */
  private release(allowTurn: boolean, vx: number, pre = 0): void {
    const f = this.flip!;
    const along = f.dir > 0 ? -vx : vx;
    // Distance swiped before the page could follow (while the resting corner cleared) still counts towards turning it
    const p = this.progress(f) + (pre * 1.1) / (2 * this.size.W);
    const go = allowTurn && (p >= COMMIT || along > FLICK_SPEED) && along > -FLICK_SPEED;
    // The corner moved 1.1× as far as the finger, in mirrored coordinates
    const vP = (f.dir > 0 ? vx : -vx) * 1.1 * 1000;
    // The bookmarks move to where they belong once this page has turned (or back, if it falls back)
    this.renderTabs(go ? this.m + 2 * f.dir : this.m);
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
      let origin: Pt = { x: 0, y: 0 };
      let wait = false;
      if (idle && dir > 0) origin = { ...idle.P };
      else if (idle) {
        wait = true;
        this.clearCorner();
      } else {
        this.beginFlip(dir, false);
        origin = this.corner(this.flip!);
      }
      w = this.wheel = { dir, dx: 0, origin, wait, pre: 0, samples: [], timer: 0, peak: 0, last: 0, shrinking: 0, events: 0 };
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
    if (w.wait && !this.flip) {
      // The resting corner is out of the way: now the left page lifts and follows from here
      this.beginFlip(w.dir, false);
      w.origin = this.corner(this.flip!);
      w.wait = false;
      w.pre = Math.max(0, w.dx);
      w.dx = 0;
      w.samples = [{ t: now, x: 0 }];
    } else if (!w.wait && this.flip && !this.flip.motion) {
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
    if (w.wait) {
      // Swiped back while the resting corner was still getting out of the way: turn the page back once it has
      this.turnBackLater(w.dx > 30 || vx > FLICK_SPEED);
      return;
    }
    const f = this.flip;
    if (!f || f.motion) {
      if (!f) this.afterLanding(120);
      return;
    }
    this.release(true, vx, w.pre);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-book': HighlighterBook;
  }
}
