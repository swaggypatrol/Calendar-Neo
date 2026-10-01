import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';
import { DayRange } from './range';

/** How long one page turn takes; turns in a row (clicking a bookmark, quick swipes) go faster per page. */
const FLIP_MS = 680;
const RIFFLE_MS = 300;
/** On release, turn the page if it has gone this far, otherwise fall back; a fast enough flick also counts. */
const COMMIT = 0.3;
const FLICK_SPEED = 0.35;
/** How many pixels the finger must move sideways before it counts as a drag. */
const DRAG_PX = 6;
/** How far out (in months from today) the page edges are shown along the fore-edges. */
const HORIZON = 24;

/** How far a lifted page corner bulges up (or down), as a fraction of the page height. */
const LIFT = 0.22;

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

const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
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
/* The sheet being turned: the front stays in place, clipped along the fold line to drop the folded part; the back is mirrored across the fold line and laid on top */
.turn {
  position: absolute;
  top: 0;
  visibility: hidden;
  transform-origin: 0 0;
}
.flip-on .turn { visibility: visible; }
.flap {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  filter: drop-shadow(0 0 7px rgba(0, 0, 0, 0.22));
}
.turn.front { z-index: 4; }
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
/* Dog-ear on the fore-edge: lifts on hover, click to turn the page */
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
 * One page turn. All geometry is computed in "mirrored coordinates": the origin is at the top of the gutter and the turning page is always on the right, x∈[0,W];
 * turning backwards (dir=-1) mirrors everything left to right. corner is the lifted page corner, P is where that corner has been pulled to,
 * and the sheet folds along the perpendicular bisector of C and P.
 */
interface Flip {
  dir: 1 | -1;
  top: boolean;
  P: Pt;
  anim: { from: Pt; to: Pt; start: number; ms: number; ease: (t: number) => number; lift: number } | null;
  /** Resting: the right page's corner is gently peeled back and breathing, ready to be pulled further. */
  idle?: boolean;
}

/**
 * <highlighter-book>: an open paper calendar. Two facing pages, with a month printed on each side of every sheet,
 * so two months are always open at once; pages turn along the gutter with a page-turn effect.
 *
 * - Press on blank space (outside the day cells) and drag left: the right page follows your finger over; drag right and the left page turns back.
 *   Drag a short way or give a light flick to turn the page, otherwise it falls back. Quick swipes in a row turn page after page.
 * - Clicking the dog-ear on a page corner also turns the page.
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
  private pages: HighlighterCalendar[] = [];
  /** The left page's month (month index = year * 12 + month). The right page is m + 1. */
  private m: number;
  private flip: Flip | null = null;
  /** Page turns requested while a turn is in progress. */
  private queue: (1 | -1)[] = [];
  private raf = 0;
  private idleRaf = 0;
  /** How far the resting corner is peeled back (px), eased towards its target every frame. */
  private peel = 0;
  private peelHover = false;
  private hintAt = -Infinity;
  /** The next queued turn should play at normal speed (a single click), not riffle speed. */
  private slowNext = false;
  /** Trackpad two-finger swipe in progress, and a short lock that swallows the momentum tail after it ends. */
  private wheel: { dir: 1 | -1; dx: number; origin: Pt; wait: boolean; samples: { t: number; x: number }[]; timer: number } | null = null;
  private wheelLock = 0;
  private selection: string[] = [];
  private range = new DayRange();
  private gesture: {
    id: number;
    x: number;
    y: number;
    t: number;
    mode: 'idle' | 'drag' | 'flick' | 'scroll' | 'wait';
    samples: { t: number; x: number }[];
    origin: Pt;
  } | null = null;

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

    for (let i = 0; i < 4; i++) {
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

    this.$prev.addEventListener('click', () => this.prev());
    this.$next.addEventListener('click', () => this.next());
    this.$book.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$book.addEventListener('pointermove', (e) => this.onMove(e));
    this.$book.addEventListener('pointerup', (e) => this.onUp(e, false));
    this.$book.addEventListener('pointercancel', (e) => this.onUp(e, true));
    this.$book.addEventListener('pointerleave', () => (this.peelHover = false));
    this.$book.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  connectedCallback(): void {
    this.layout();
    this.rest();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    cancelAnimationFrame(this.idleRaf);
    this.idleRaf = 0;
    if (this.flip) this.finishFlip(this.progress(this.flip) >= 0.5);
    this.queue = [];
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
    this.rest();
  }

  /** Lift the resting corner higher for a moment and let it settle back, hinting that pages can be turned. */
  hint(): void {
    this.hintAt = performance.now();
    this.rest();
  }

  // ---------- Page turning ----------

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

  /**
   * At rest the right page's bottom corner is the actual sheet, peeled back a little and slowly breathing. Every turn
   * (click, drag, swipe, bookmark) starts from this same corner, so the paper never jumps from a fake dog-ear to the real page.
   */
  private rest(): void {
    if (this.flip || this.gesture || this.wheel || this.queue.length || !this.isConnected || !this.canFlip(1)) return;
    if (!this.$right.offsetWidth) return;
    this.beginFlip(1, false);
    this.flip!.idle = true;
    this.peel = 0;
    if (!this.idleRaf) this.idleRaf = requestAnimationFrame(this.idleTick);
  }

  private idleTick = (now: number): void => {
    this.idleRaf = 0;
    const f = this.flip;
    if (!f?.idle) return;
    // Hidden (e.g. the date field is closed): don't burn frames, check again later
    const visible = this.$book.checkVisibility ? this.$book.checkVisibility({ visibilityProperty: true }) : true;
    if (!visible) {
      window.setTimeout(() => {
        if (!this.idleRaf && this.flip?.idle) this.idleRaf = requestAnimationFrame(this.idleTick);
      }, 400);
      return;
    }
    const t = now / 1000;
    let target = this.peelHover ? 120 : 72 + 12 * Math.sin((t * 2 * Math.PI) / 3.6);
    const since = (now - this.hintAt) / 1000;
    if (since >= 0 && since < 1.6) target += 60 * Math.sin(Math.min(1, since / 0.5) * Math.PI * 0.5) * Math.exp(-since * 2.2);
    this.peel += (target - this.peel) * 0.12;
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

  private request(dir: 1 | -1, fast = false): void {
    const f = this.flip;
    if (f && !f.idle) {
      this.queue.push(dir);
      return;
    }
    if (!this.canFlip(dir)) return;
    const ms = fast ? RIFFLE_MS : FLIP_MS;
    const ease = fast ? easeOut : easeInOut;
    if (f?.idle) {
      this.takeIdle();
      if (dir > 0) {
        // Keep pulling the corner that is already peeled back
        this.renderTabs(this.m + 2 * dir);
        this.animateTo(true, ms, ease);
        return;
      }
      // Turning back: let the peeled corner settle down first, then turn the left page
      this.animateTo(false, 160, easeOut);
      this.queue.unshift(-1);
      this.slowNext = !fast;
      return;
    }
    this.beginFlip(dir, false);
    this.renderTabs(this.m + 2 * dir);
    this.animateTo(true, ms, ease);
  }

  /** Set a page (calendar element) to a month; if it already shows that month, leave it alone (keeping any hand-drawn strokes). */
  private setMonth(el: HighlighterCalendar, k: number): void {
    const key = keyOf(k);
    if (el.month !== key) el.month = key;
    el.toggleAttribute('vignette', k < this.todayIndex);
  }

  private spare(): HighlighterCalendar[] {
    return this.pages.filter((c) => c.parentElement === this.$pool);
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
    const [a, b] = this.spare();
    if (dir > 0) {
      this.setMonth(a, this.m + 2);
      this.setMonth(b, this.m + 3);
      this.holder(this.$front).append(right);
      this.holder(this.$back).append(a);
      this.holder(this.$right).append(b);
    } else {
      this.setMonth(a, this.m - 1);
      this.setMonth(b, this.m - 2);
      // Backward: the left page (m) stays in place, and what folds over to show is its other side (m-1)
      this.holder(this.$front).append(left);
      this.holder(this.$back).append(a);
      this.holder(this.$left).append(b);
    }
    this.flip = { dir, top, P: { x: W, y: top ? 0 : H }, anim: null };
    this.flip.P = this.corner(this.flip);
    this.$spread.classList.add('flip-on');
    this.$book.classList.add('busy');
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
    this.$spread.classList.remove('flip-on');
    this.$book.classList.remove('busy');
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

  /** Move the corner along a bulging arc to the other side (done=true) or back into place. */
  private animateTo(done: boolean, ms: number, ease: (t: number) => number): void {
    const f = this.flip!;
    const { W, H } = this.size;
    const C = this.corner(f);
    const to = done ? { x: -W, y: C.y } : C;
    // The farther it travels the higher it arcs; lifted from a bottom corner it arcs up, from a top corner it arcs down
    const lift = (f.top ? 1 : -1) * LIFT * H * Math.min(1, Math.abs(to.x - f.P.x) / (2 * W));
    f.anim = { from: { ...f.P }, to, start: performance.now(), ms, ease, lift };
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    this.raf = 0;
    const f = this.flip;
    if (!f?.anim) return;
    const a = f.anim;
    const t = clamp01((now - a.start) / a.ms);
    const e = a.ease(t);
    f.P = {
      x: a.from.x + (a.to.x - a.from.x) * e,
      y: a.from.y + (a.to.y - a.from.y) * e + a.lift * Math.sin(Math.PI * e),
    };
    this.render();
    if (t < 1) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.finishFlip(a.to.x < 0);
    // Queued turns: flip quickly page after page
    while (this.queue.length) {
      const dir = this.queue.shift()!;
      if (this.canFlip(dir)) {
        const slow = this.slowNext;
        this.slowNext = false;
        this.beginFlip(dir, false);
        this.renderTabs(this.m + 2 * dir);
        this.animateTo(true, slow ? FLIP_MS : RIFFLE_MS, slow ? easeInOut : this.queue.length ? (x) => x : easeOut);
        return;
      }
    }
    this.slowNext = false;
    this.rest();
  };

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
      // Not lifted yet
      this.$front.style.clipPath = '';
      this.$back.style.clipPath = polyCss([]);
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
    const bend = Math.sin(Math.PI * Math.min(1, p * 1.15));
    const flapW = Math.max(10, Math.min(dl / 2, W));

    // Front: darker near the fold line where the paper curls up
    this.strip(this.$front, toFront(A), toFront(B), toFront(P), 26 + 30 * bend, `rgba(0,0,0,${(0.22 * bend + 0.05).toFixed(3)}), transparent`);
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
    (this.$back.parentElement as HTMLElement).style.filter = `drop-shadow(0 0 ${(7 * bend).toFixed(1)}px rgba(0, 0, 0, ${(0.22 * bend).toFixed(3)}))`;
    // Page below: the shadow cast by the lifted sheet, hugging the fold line and fading outwards
    const under = f.dir > 0 ? this.$right : this.$left;
    this.strip(under, toFront(A), toFront(B), toFront(C), 18 + 50 * bend, `rgba(0,0,0,${(0.3 * bend).toFixed(3)}), transparent`);
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
    el.style.visibility = 'visible';
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
    if (k === this.m || k === this.m + 1) {
      // It only moved from the left page to the right (or vice versa): nothing to do, just restore the page's original month
      this.setMonth(c, was);
      return;
    }
    this.setMonth(c, was);
    this.request(k > was ? 1 : -1);
  }

  // ---------- Gesture: press on blank space and drag sideways, the sheet follows the finger ----------

  private isBlank(e: Event): boolean {
    return !e
      .composedPath()
      .some((n) => n instanceof HTMLElement && (n.classList.contains('wrap') || n.localName === 'button'));
  }

  private onDown(e: PointerEvent): void {
    if (this.gesture || (e.pointerType === 'mouse' && e.button !== 0) || !this.isBlank(e)) return;
    this.gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      mode: 'idle',
      samples: [{ t: e.timeStamp, x: e.clientX }],
      origin: { x: 0, y: 0 },
    };
    try {
      this.$book.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no real pointer
    }
  }

  private onMove(e: PointerEvent): void {
    // Pointing near the resting corner peels it back further, inviting a pull
    if (!this.gesture && this.flip?.idle) {
      const r = this.$right.getBoundingClientRect();
      this.peelHover = Math.hypot(r.right - e.clientX, r.bottom - e.clientY) < 110;
    }
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    if (g.mode === 'wait') {
      // The peeled corner has settled: now lift the left page from where the finger is
      if (this.flip) return;
      const r = this.$spread.getBoundingClientRect();
      this.beginFlip(-1, e.clientY < r.top + r.height / 2);
      g.origin = this.corner(this.flip!);
      g.x = e.clientX;
      g.y = e.clientY;
      g.mode = 'drag';
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    g.samples.push({ t: e.timeStamp, x: e.clientX });
    while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();

    if (g.mode === 'idle') {
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) {
        g.mode = 'scroll';
        return;
      }
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      if (this.flip && !this.flip.idle) {
        // The previous page is still turning: this counts as "turn one more page"
        g.mode = 'flick';
        this.queue.push(dir);
        return;
      }
      if (!this.canFlip(dir)) {
        g.mode = 'scroll';
        return;
      }
      const idle = this.takeIdle();
      if (idle && dir > 0) {
        // Pull the corner that is already peeled back; the paper stays one continuous sheet
        g.mode = 'drag';
        g.origin = { ...idle.P };
      } else if (idle) {
        // Turning back: let the peeled corner settle first, then the left page follows the finger
        g.mode = 'wait';
        this.animateTo(false, 140, easeOut);
        return;
      } else {
        g.mode = 'drag';
        // Pressing on the top half of the page lifts the top corner, the bottom half lifts the bottom corner
        const r = this.$spread.getBoundingClientRect();
        this.beginFlip(dir, g.y < r.top + r.height / 2);
        g.origin = this.corner(this.flip!);
      }
    }
    if (g.mode !== 'drag' || !this.flip) return;
    // The corner follows the finger (by how far the finger has moved, wherever it was pressed)
    const f = this.flip;
    const mdx = f.dir > 0 ? dx : -dx;
    f.P = this.constrain(f, { x: g.origin.x + mdx * 1.1, y: g.origin.y + dy * 0.6 });
    this.render();
  }

  /**
   * Trackpad two-finger swipe (Mac): sideways wheel events drive the page exactly like a drag, following the fingers
   * and momentum; when the events stop, the page turns or falls back, as with letting go.
   */
  private onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const now = performance.now();
    const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    let w = this.wheel;
    if (!w) {
      // Swallow the momentum tail of the previous swipe
      if (now < this.wheelLock) {
        this.wheelLock = now + 160;
        return;
      }
      if ((this.flip && !this.flip.idle) || this.gesture) return;
      const dir: 1 | -1 = e.deltaX > 0 ? 1 : -1;
      if (!this.canFlip(dir)) {
        this.wheelLock = now + 300;
        return;
      }
      const idle = this.takeIdle();
      let origin: Pt = { x: 0, y: 0 };
      let wait = false;
      if (idle && dir > 0) origin = { ...idle.P };
      else if (idle) {
        wait = true;
        this.animateTo(false, 140, easeOut);
      } else {
        this.beginFlip(dir, false);
        origin = this.corner(this.flip!);
      }
      w = this.wheel = { dir, dx: 0, origin, wait, samples: [], timer: 0 };
    }
    if (w.wait && !this.flip) {
      this.beginFlip(w.dir, false);
      w.origin = this.corner(this.flip!);
      w.wait = false;
      w.dx = 0;
    }
    w.dx -= e.deltaX * step;
    w.samples.push({ t: now, x: w.dx });
    while (w.samples.length > 2 && now - w.samples[0].t > 100) w.samples.shift();
    if (!w.wait && this.flip && !this.flip.anim) {
      const mdx = w.dir > 0 ? w.dx : -w.dx;
      this.flip.P = this.constrain(this.flip, { x: w.origin.x + mdx * 1.1, y: w.origin.y - Math.min(40, Math.abs(mdx) * 0.15) });
      this.render();
    }
    clearTimeout(w.timer);
    w.timer = window.setTimeout(() => this.endWheel(), 140);
  }

  private endWheel(): void {
    const w = this.wheel;
    this.wheel = null;
    this.wheelLock = performance.now() + 350;
    const f = this.flip;
    if (!w || w.wait || !f || f.anim) {
      if (!this.flip) this.rest();
      return;
    }
    const s0 = w.samples[0];
    const s1 = w.samples[w.samples.length - 1];
    const vx = s0 && s1 && s1.t > s0.t ? (s1.x - s0.x) / (s1.t - s0.t) : 0;
    const along = f.dir > 0 ? -vx : vx;
    const p = this.progress(f);
    const go = (p >= COMMIT || along > FLICK_SPEED) && along > -FLICK_SPEED;
    if (go) this.renderTabs(this.m + 2 * f.dir);
    this.animateTo(go, Math.max(180, FLIP_MS * 0.75 * (go ? 1 - p : p)), easeOut);
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    if (g.mode !== 'drag' || !this.flip) {
      if (!this.flip) this.rest();
      return;
    }
    const s0 = g.samples[0];
    const vx = e.timeStamp > s0.t ? (e.clientX - s0.x) / (e.timeStamp - s0.t) : 0;
    const f = this.flip;
    const along = f.dir > 0 ? -vx : vx;
    const p = this.progress(f);
    const go = !cancelled && (p >= COMMIT || along > FLICK_SPEED) && along > -FLICK_SPEED;
    // Decided to turn: the bookmarks move to their new positions along with this page
    if (go) this.renderTabs(this.m + 2 * f.dir);
    this.animateTo(go, Math.max(180, FLIP_MS * 0.75 * (go ? 1 - p : p)), easeOut);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-book': HighlighterBook;
  }
}
