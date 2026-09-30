import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';
import { DayRange } from './range';

/** Offset at which each card in a pile peeks out. */
const STACK_DX = 1.2;
const STACK_DY = 3.2;
/** Duration of one programmatic next() / prev() step; eases in, then out. */
const STEP_MS = 720;
/** Longest / shortest time a released card takes to travel the rest of the way on its own. */
const RELEASE_MS = 480;
const RELEASE_MIN_MS = 160;
/** How far (in months from today) the piles are drawn month by month; months further out are squashed into one bottom layer. */
const HORIZON = 24;
/** Most cards ever visible at once: top of the left pile, the two laid out, top of the right pile. */
const POOL_SIZE = 5;
const EPS = 1e-6;

/** Horizontal movement in pixels before a press counts as a drag. */
const DRAG_PX = 6;
/** Swiping while cards are still moving: horizontal pixels that count as one swipe (used to speed up the spinner). */
const SWIPE_PX = 36;
/** On release, flip if dragged past this fraction of the way; otherwise spring back. */
const COMMIT = 0.3;
/** A release faster than this (px / ms) also flips: a light flick is enough. */
const FLICK_SPEED = 0.35;
/** Swiping the same way again within this long after the last step settled also counts as a "rapid swipe". */
const GRACE_MS = 250;
/** At the end of the selectable range: programmatic calls nudge the whole row and bounce back; drags follow the finger with resistance and spring back on release. */
const BUMP_PX = 22;
const BUMP_MS = 380;
const RUBBER = 0.35;
const RUBBER_MAX = 70;

/**
 * Spinner physics (units: months, seconds). Each swipe adds `impulse` to the velocity;
 * damping decays the velocity as e^(-damping·t), and once it drops below snapSpeed
 * a critically damped spring pulls it onto the nearest month and stops it there.
 */
const SPIN = {
  impulse: 5,
  maxSpeed: 14,
  damping: 4.5,
  snapSpeed: 1.8,
  spring: 16,
  /** How fast the right-hand card spreads out once spinning. */
  open: 12,
};

/** Ease in, then out. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** Ease out only: on release the card is already moving with the finger, so it glides on and slows to a stop. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Slope of an easing curve: when switching to spin mode mid-animation, pick up the current velocity so there's no hitch. */
const slope = (e: (t: number) => number, t: number) => {
  const h = 1e-3;
  return (e(Math.min(1, t + h)) - e(Math.max(0, t - h))) / (Math.min(1, t + h) - Math.max(0, t - h));
};
const lerp = (x: number, y: number, t: number) => x + (y - x) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * State of the card stream. f is the month of the leftmost card on the table (month index = year * 12 + month),
 * a continuous fraction while spinning; b is how far the right-hand card is spread out: 0 = one card, 1 = two side by side.
 */
interface View {
  f: number;
  b: number;
}

/** Animate from `from` to `to`. dir is the flip direction (0 when collapsing). */
interface Tween {
  from: View;
  to: View;
  start: number;
  ms: number;
  ease: (t: number) => number;
  dir: 1 | -1 | 0;
}

/**
 * Spinner: v is the velocity (months / second), snap is the month it is snapping to.
 * origin / count record where this run of same-direction swipes started and how many there were;
 * it turns at least that many months before stopping, so every swipe moves at least one card.
 */
interface Spin {
  v: number;
  snap: number | null;
  dir: 1 | -1;
  origin: number;
  count: number;
}

/** A finger pressed on blank space. Drag state: starting view, target view, and how long the path is. */
interface Gesture {
  id: number;
  x: number;
  y: number;
  t: number;
  /** 'idle' not moved yet; 'drag' cards follow the finger; 'flick' cards are already moving, this swipe only adds speed; 'scroll' vertical swipe, ignored. */
  mode: 'idle' | 'drag' | 'flick' | 'scroll';
  base: View;
  dir: 1 | -1 | 0;
  target: View | null;
  travel: number;
  rubber: number;
  samples: { t: number; x: number }[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthIndex = (y: number, m0: number) => y * 12 + m0;
const m0Of = (k: number) => ((k % 12) + 12) % 12;
const keyOf = (k: number) => `${Math.floor(k / 12)}-${pad2(m0Of(k) + 1)}`;
const parseKey = (s: string): number | null => {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  return m ? monthIndex(Number(m[1]), Math.min(11, Math.max(0, Number(m[2]) - 1))) : null;
};

/** One layer (one month) of a pile: glow means the month has selected days; gap is the space between it and the layer above. */
interface Layer {
  glow: boolean;
  gap: number;
}

const GLOW = 'color-mix(in srgb, var(--hc-ink, #ffd21f) 85%, transparent)';

/**
 * A card pile drawn in the card's own box-shadow: months stacked layer by layer, thinner further down, with an extra gap at year boundaries.
 * Layers with selected days get a highlighter-coloured edge and a glow leaking through the gap. side=1 stacks down-right, -1 down-left.
 * selfGlow: when this card itself sits under another one with only an edge showing, it also glows for its own month.
 */
function stackShadow(layers: Layer[], side: 1 | -1, selfGlow = false): string {
  const parts = [`0 0 0 1px ${selfGlow ? GLOW : 'var(--hc-card-edge)'}`];
  // When tucked under another card, the glow only leaks out of the exposed edge, toward the pile side
  if (selfGlow) parts.push(`${2 * side}px 5px 7px -2px ${GLOW}`);
  let dy = 0;
  for (const l of layers) {
    dy += l.gap;
    const dx = ((dy * STACK_DX) / STACK_DY) * side;
    const x = dx.toFixed(1);
    const y = dy.toFixed(1);
    parts.push(`${x}px ${y}px 0 -1px var(--hc-card-bg)`, `${x}px ${y}px 0 0 ${l.glow ? GLOW : 'var(--hc-card-edge)'}`);
    if (l.glow) parts.push(`${(dx + side).toFixed(1)}px ${(dy + 2.5).toFixed(1)}px 6px -2px ${GLOW}`);
  }
  const sx = (((dy * STACK_DX) / STACK_DY) * side + 2 * side).toFixed(1);
  parts.push(`${sx}px ${(dy + 8).toFixed(1)}px 22px rgba(0, 0, 0, 0.10)`, '0 1px 2px rgba(0, 0, 0, 0.06)');
  return parts.join(', ');
}

const STYLE = /* css */ `
:host {
  --hc-card-bg: #ffffff;
  --hc-card-edge: rgba(20, 30, 50, 0.14);
  --hc-card-width: 22rem;
  --deck-gap: 20px;
  display: block;
}
@media (prefers-color-scheme: dark) {
  :host {
    --hc-card-bg: #2a2e35;
    --hc-card-edge: rgba(255, 255, 255, 0.14);
  }
}
.deck {
  display: grid;
  justify-content: center;
  align-items: start;
  width: calc(2 * var(--hc-card-width) + var(--deck-gap));
  max-width: 100%;
  margin: 0 auto;
  padding: 8px 0 56px;
  perspective: 1600px;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
highlighter-calendar {
  grid-area: 1 / 1;
  width: var(--hc-card-width);
  border-radius: 16px;
  background: var(--hc-card-bg);
  touch-action: pan-y;
}
highlighter-calendar.hidden { visibility: hidden; }
highlighter-calendar.hidden,
highlighter-calendar.inert,
.deck.busy highlighter-calendar { pointer-events: none; }
`;

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay', 'min', 'max'];

/**
 * <highlighter-deck>: a stream of month cards, at most two side by side, that follows the finger like paging on a touch screen.
 *
 * Normally only the current month shows, with the rest of the year stacked underneath. Press on blank space (outside the day cells) and drag sideways:
 * - The card under your finger follows it. Drag left and the card slides away to the left while next month comes out of the pile to fill the gap;
 *   drag right and the card slides away to the right while last month slides in from off-screen on the left;
 * - One drag flips one card. Drag a little way or flick lightly and it flips on release; otherwise it springs back;
 * - Swipe the same way again before the last one settles and it enters spin mode: a damped spinner that gets another push with every swipe;
 * - Tap: collapse back to one card, keeping the month you tapped.
 * All cards share a single selection; attributes and input / change events are the same as <highlighter-calendar>.
 */
export class HighlighterDeck extends HTMLElement {
  static observedAttributes = ['month', 'value', 'spread', ...FORWARDED];

  private $deck: HTMLElement;
  private pool: HighlighterCalendar[] = [];
  /** Month index each card is currently showing. */
  private assigned = new Map<HighlighterCalendar, number>();
  private view: View;
  /** View at the last full stop, used to decide whether to fire monthchange / spreadchange. */
  private settledView: View;
  private tween: Tween | null = null;
  private spin: Spin | null = null;
  /** Action received mid-animation, deferred until things settle. */
  private pending: 1 | -1 | View | null = null;
  private lastStep = { end: -Infinity, dir: 0 };
  private raf = 0;
  private lastT = 0;
  private selection: string[] = [];
  /** Months (month indices) containing selected days; the piles glow for these. */
  private months = new Set<number>();
  private hinting = 0;
  private gesture: Gesture | null = null;
  private shadows = new Map<HighlighterCalendar, string>();
  private navShown: boolean | null = null;
  private ro: ResizeObserver | null = null;
  /** Selectable range (min / max): the stream won't go to months with no selectable days at all. */
  private range = new DayRange();
  /** Bounce at the ends: wiggle is a programmatic nudge-and-return; back springs from `from` px back to 0 after a drag is released. */
  private bump: { kind: 'wiggle' | 'back'; from: number; start: number } | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div class="deck" part="deck"></div>`;
    this.$deck = root.querySelector('.deck')!;
    for (let i = 0; i < POOL_SIZE; i++) {
      const c = document.createElement('highlighter-calendar');
      c.classList.add('hidden');
      c.addEventListener('input', () => this.sync(c));
      c.addEventListener('change', () => this.sync(c));
      c.addEventListener('monthchange', (e) => {
        e.stopPropagation();
        this.onCardMonth(c);
      });
      this.$deck.append(c);
      this.pool.push(c);
    }
    const now = new Date();
    this.view = { f: monthIndex(now.getFullYear(), now.getMonth()), b: 0 };
    this.settledView = { ...this.view };

    this.$deck.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$deck.addEventListener('pointermove', (e) => this.onMove(e));
    this.$deck.addEventListener('pointerup', (e) => this.onUp(e, false));
    this.$deck.addEventListener('pointercancel', (e) => this.onUp(e, true));
  }

  connectedCallback(): void {
    this.place();
    this.ro = new ResizeObserver(() => this.place());
    this.ro.observe(this.$deck);
  }

  disconnectedCallback(): void {
    this.ro?.disconnect();
    this.ro = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.gesture = null;
    this.bump = null;
    if (this.moving) this.jump(this.restingF);
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    if (name === 'month') {
      const k = v ? parseKey(v) : null;
      if (k !== null) this.jump(k);
    } else if (name === 'value') {
      this.value = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (name === 'spread') {
      // Initial state only: start with two months side by side
      this.view = this.clampView({ ...this.view, b: v !== null ? 1 : 0 });
      this.settledView = { ...this.view };
      this.place();
    } else {
      for (const c of this.pool) {
        if (v === null) c.removeAttribute(name);
        else c.setAttribute(name, v);
      }
      if (name === 'min' || name === 'max') {
        this.range.set(name, v);
        // Each card has already dropped selections outside the range
        this.selection = this.pool[0].value;
        this.selectionChanged();
        this.jump(this.restingF);
      }
    }
  }

  // ---------- Public API ----------

  get value(): string[] {
    return [...this.selection];
  }

  set value(keys: string[]) {
    this.selection = [...new Set(keys)].sort();
    for (const c of this.pool) c.value = this.selection;
    this.selectionChanged();
  }

  /** Month of the leftmost card (the only one when single), YYYY-MM; while moving, the month it will stop on. */
  get month(): string {
    return keyOf(this.restingF);
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  /** Whether two months are laid out side by side. true lays out next month; false collapses to one card. */
  get spread(): boolean {
    if (this.spin) return true;
    return (this.tween?.to ?? this.view).b > 0;
  }

  set spread(on: boolean) {
    const to = this.clampView({ f: Math.round(this.view.f), b: on ? 1 : 0 });
    if (this.moving) {
      this.pending = to;
      return;
    }
    if (this.view.b !== to.b) this.tweenTo(to, 0, STEP_MS, easeInOut);
  }

  get tool(): Tool {
    return this.pool[0].tool;
  }

  set tool(t: Tool) {
    for (const c of this.pool) c.tool = t;
  }

  get color(): string {
    return this.pool[0].color;
  }

  set color(v: string) {
    this.style.setProperty('--hc-ink', v);
    for (const c of this.pool) c.color = v;
  }

  get threshold(): number {
    return this.pool[0].threshold;
  }

  set threshold(n: number) {
    for (const c of this.pool) c.threshold = n;
  }

  clear(): void {
    const before = this.selection;
    if (!before.length) return;
    this.selection = [];
    for (const c of this.pool) c.clear(true);
    this.selectionChanged();
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value: [], added: [], removed: before },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Flip to next month; same as dragging left once on blank space. */
  next(): void {
    this.swipe(1);
  }

  /** Flip to previous month; same as dragging right once on blank space. */
  prev(): void {
    this.swipe(-1);
  }

  /** Jump straight to a month and collapse to one card, without animation (used each time the date field opens). */
  show(month: string): void {
    const k = parseKey(month);
    if (k === null) return;
    this.stopHint();
    this.view = { f: k, b: 0 };
    this.jump(k);
  }

  /** With a single card, make the top of the right pile peek out and wiggle twice, hinting that another month can be laid out. */
  hint(): void {
    if (this.moving || this.gesture || this.hinting || this.view.b > 0) return;
    if (!this.inRange({ f: Math.round(this.view.f), b: 1 })) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (this.moving || this.gesture || t > 1.1) {
        this.hinting = 0;
        if (!this.moving && !this.gesture) {
          this.view = { ...this.view, b: 0 };
          this.place();
        }
        return;
      }
      this.view = { ...this.view, b: 0.1 * Math.abs(Math.sin((t * Math.PI) / 0.32)) * Math.exp(-t * 2.4) };
      this.place();
      this.hinting = requestAnimationFrame(tick);
    };
    this.hinting = requestAnimationFrame(tick);
  }

  private stopHint(): void {
    if (!this.hinting) return;
    cancelAnimationFrame(this.hinting);
    this.hinting = 0;
    this.view = { ...this.view, b: 0 };
  }

  // ---------- Flipping and spinning ----------

  private get moving(): boolean {
    return this.tween !== null || this.spin !== null;
  }

  /** The month it rests on now (or once the motion finishes). */
  private get restingF(): number {
    return Math.round(this.tween?.to.f ?? this.spin?.snap ?? this.view.f);
  }

  /**
   * Flip one card: dir=1 next month (flip left), -1 previous month (flip right).
   * With one card, flipping left lays next month out on the right and flipping right lays last month out on the left;
   * with two side by side, the whole row shifts by one slot. Returns null outside the selectable range.
   */
  private stepTarget(from: View, dir: 1 | -1): View | null {
    const f = Math.round(from.f);
    const b = Math.round(from.b);
    const to = dir > 0 ? (b < 1 ? { f, b: 1 } : { f: f + 1, b: 1 }) : { f: f - 1, b: 1 };
    return this.inRange(to) ? to : null;
  }

  /** How far (px) the card under the finger travels in this step: half a slot for side-by-side <-> single, a full slot for a shift. */
  private travelOf(from: View, to: View): number {
    return Math.abs(to.f - from.f) >= 1 && Math.abs(to.b - from.b) < 0.5 ? this.pitch : this.pitch / 2;
  }

  /**
   * Programmatic flip (or a swipe while cards are still moving): swiping the same way before the last one settles enters spin mode;
   * while spinning, each swipe gives the spinner another push, and swiping the other way pulls it back.
   */
  private swipe(dir: 1 | -1): void {
    this.stopHint();
    if (this.spin) {
      this.push(dir);
    } else if (this.tween) {
      if (this.tween.dir === dir) this.startSpin(dir);
      else this.pending = dir;
    } else if (performance.now() - this.lastStep.end < GRACE_MS && this.lastStep.dir === dir) {
      this.startSpin(dir);
    } else {
      this.step(dir);
    }
  }

  private step(dir: 1 | -1): void {
    const to = this.stepTarget(this.view, dir);
    if (!to) {
      this.wiggle(dir);
      return;
    }
    this.tweenTo(to, dir, STEP_MS, easeInOut);
  }

  /** Hit the end: nudge the whole row the way the finger would drag, then bounce back (dragging left means next month). */
  private wiggle(dir: 1 | -1): void {
    this.bump = { kind: 'wiggle', from: -dir * BUMP_PX, start: performance.now() };
    this.kick();
  }

  /** Tap on blank space: collapse to one card, keeping the tapped month. Tapping while spinning is like grabbing the spinner: stop at the nearest month, then collapse. */
  private tap(e: PointerEvent): void {
    if (this.spin) {
      this.spin.snap = Math.min(this.fMax(1), Math.max(this.range.minMonth, Math.round(this.view.f)));
      this.pending = { f: this.spin.snap, b: 0 };
    } else if (this.tween) {
      this.pending = { f: this.tween.to.f, b: 0 };
    } else if (this.view.b > 0) {
      // Tapped on the right-hand card: keep that one, otherwise keep the left
      const r = this.$deck.getBoundingClientRect();
      const right = e.clientX > r.left + r.width / 2 + this.pitch * 0.1;
      this.tweenTo({ f: this.view.f + (right ? 1 : 0), b: 0 }, 0, STEP_MS, easeInOut);
    }
  }

  private jump(k: number): void {
    this.tween = null;
    this.spin = null;
    this.pending = null;
    this.$deck.classList.remove('busy');
    this.view = this.clampView({ f: k, b: Math.round(this.view.b) });
    this.settledView = { ...this.view };
    this.assigned.clear();
    this.place();
  }

  /** Every card laid out (f to f+b) is within the selectable range. */
  private inRange(v: View): boolean {
    this.range.refresh();
    return v.f >= this.range.minMonth - EPS && v.f + v.b <= this.range.maxMonth + EPS;
  }

  /** Clamp a view into the selectable range: the left card stays in bounds; if the right one would be out of bounds, don't spread. */
  private clampView(v: View): View {
    this.range.refresh();
    const { minMonth: lo, maxMonth: hi } = this.range;
    const f = Math.min(hi, Math.max(lo, v.f));
    return { f, b: Math.min(v.b, Math.max(0, hi - f)) };
  }

  /** Furthest month the leftmost card can reach with b cards side by side. */
  private fMax(b: number): number {
    const { minMonth: lo, maxMonth: hi } = this.range;
    return Math.max(lo, hi - b);
  }

  private begin(): void {
    if (this.moving) return;
    this.range.refresh();
    this.$deck.classList.add('busy');
  }

  private tweenTo(to: View, dir: 1 | -1 | 0, ms: number, ease: (t: number) => number): void {
    this.begin();
    this.tween = { from: { ...this.view }, to, start: performance.now(), ms, ease, dir };
    this.kick();
  }

  private startSpin(dir: 1 | -1): void {
    let v = 0;
    let origin = Math.round(this.view.f);
    let count = 0;
    const tw = this.tween;
    if (tw) {
      // Pick up the velocity of the step currently playing; if that step was a shift, it counts as one card too
      const p = clamp01((performance.now() - tw.start) / tw.ms);
      v = ((tw.to.f - tw.from.f) * slope(tw.ease, p)) / (tw.ms / 1000);
      origin = Math.round(tw.from.f);
      count = Math.abs(Math.round(tw.to.f - tw.from.f));
      this.tween = null;
    }
    this.begin();
    this.spin = { v, snap: null, dir, origin, count };
    this.push(dir);
    this.kick();
  }

  private push(dir: 1 | -1): void {
    const s = this.spin!;
    if (dir !== s.dir) {
      // Pulling the other way: start counting again from the current position
      s.origin = Math.round(this.view.f);
      s.count = 0;
      s.dir = dir;
    }
    s.count++;
    s.v = Math.max(-SPIN.maxSpeed, Math.min(SPIN.maxSpeed, s.v + dir * SPIN.impulse));
    s.snap = null;
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    this.raf = 0;
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    if (this.bump && now - this.bump.start >= BUMP_MS) this.bump = null;
    if (this.spin) this.stepSpin(dt);
    else if (this.tween) this.stepTween(now);
    else this.place();
    if (this.moving || this.bump) this.kick();
    else this.lastT = 0;
  };

  private stepTween(now: number): void {
    const tw = this.tween!;
    const p = clamp01((now - tw.start) / tw.ms);
    if (p >= 1) {
      this.view = { ...tw.to };
      this.tween = null;
      if (tw.dir) this.lastStep = { end: now, dir: tw.dir };
      this.settle();
      return;
    }
    const e = tw.ease(p);
    this.view = { f: lerp(tw.from.f, tw.to.f, e), b: lerp(tw.from.b, tw.to.b, e) };
    this.place();
  }

  private stepSpin(dt: number): void {
    const s = this.spin!;
    let { f, b } = this.view;
    const lo = this.range.minMonth;
    const hi = this.fMax(1);
    if (s.snap === null) {
      s.v *= Math.exp(-SPIN.damping * dt);
      f += s.v * dt;
      // Slowed down: stop at the month nearest to where it would coast at this speed, but turn at least as many months as there were swipes
      if (Math.abs(s.v) < SPIN.snapSpeed) {
        const rest = Math.round(f + s.v / SPIN.damping);
        const least = s.origin + s.dir * s.count;
        s.snap = Math.min(hi, Math.max(lo, s.dir > 0 ? Math.max(rest, least) : Math.min(rest, least)));
      }
    } else {
      const w = SPIN.spring;
      s.v += (-w * w * (f - s.snap) - 2 * w * s.v) * dt;
      f += s.v * dt;
    }
    // Reached the end of the selectable range: hit the wall and stop
    if (f < lo || f > hi) {
      f = Math.min(hi, Math.max(lo, f));
      s.v = 0;
      s.snap = f;
    }
    // While spinning, show two side by side; if the right card is out of range, don't spread
    const tb = clamp01(this.range.maxMonth - f);
    const k = 1 - Math.exp(-SPIN.open * dt);
    const nb = b + (tb - b) * k;
    b = Math.min(Math.abs(nb - tb) < 0.001 ? tb : nb, Math.max(0, this.range.maxMonth - f));
    this.view = { f, b };
    if (s.snap !== null && Math.abs(f - s.snap) < 0.002 && Math.abs(s.v) < 0.05 && b === tb) {
      this.view = this.clampView({ f: s.snap, b: 1 });
      this.spin = null;
      this.lastStep = { end: performance.now(), dir: s.dir };
      this.settle();
      return;
    }
    this.place();
  }

  /** A motion has settled: run any queued action, otherwise come to a real stop and fire events. */
  private settle(): void {
    const next = this.pending;
    this.pending = null;
    if (next !== null && typeof next === 'object') {
      const to = this.clampView(next);
      if (to.f !== this.view.f || to.b !== this.view.b) {
        this.place();
        this.tweenTo(to, 0, STEP_MS, easeInOut);
        return;
      }
    }
    if (next === 1 || next === -1) {
      const to = this.stepTarget(this.view, next);
      if (to) {
        this.place();
        this.tweenTo(to, next, STEP_MS, easeInOut);
        return;
      }
    }
    this.$deck.classList.remove('busy');
    this.place();
    const from = this.settledView;
    this.settledView = { ...this.view };
    if (from.f !== this.view.f) this.emit('monthchange', { month: this.month });
    if (from.b !== this.view.b) this.emit('spreadchange', { spread: this.view.b > 0 });
  }

  // ---------- Layout ----------

  private get cardWidth(): number {
    return this.pool[0].offsetWidth || 352;
  }

  /** Distance between two adjacent cards (one slot). */
  private get pitch(): number {
    const gap = parseFloat(getComputedStyle(this).getPropertyValue('--deck-gap')) || 20;
    return this.cardWidth + gap;
  }

  private get todayIndex(): number {
    const now = new Date();
    return monthIndex(now.getFullYear(), now.getMonth());
  }

  /**
   * The pile under card k (on the `side` side): one layer per month within HORIZON months of today and inside the selectable range;
   * further months are squashed into one bottom layer, so the pile never grows without bound however far you spin, and far-off selected days still glow.
   */
  private pile(k: number, side: 1 | -1): Layer[] {
    const bound = side > 0 ? this.range.maxMonth : this.range.minMonth;
    const horizon = this.todayIndex + side * HORIZON;
    const limit = side > 0 ? Math.min(horizon, bound) : Math.max(horizon, bound);
    const layers: Layer[] = [];
    let i = 0;
    for (let m = k + side; side > 0 ? m <= limit : m >= limit; m += side) {
      const yearGap = m0Of(m) === (side > 0 ? 0 : 11) ? 1.8 : 0;
      layers.push({ glow: this.months.has(m), gap: Math.max(0.9, STACK_DY * 0.9 ** i) + yearGap });
      i++;
    }
    // Selectable range extends beyond two years: squash the further months into one layer
    if (limit !== bound) {
      const edge = side > 0 ? Math.max(limit, k) : Math.min(limit, k);
      let far = false;
      for (const m of this.months) if (side > 0 ? m > edge : m < edge) far = true;
      layers.push({ glow: far, gap: 1.6 });
    }
    return layers;
  }

  /** Extra pixels the whole row is shifted right now: rubber-band follow at the ends, or the bounce back after a release / programmatic call. */
  private nudge(): number {
    const g = this.gesture;
    if (g?.mode === 'drag' && !g.target) return g.rubber;
    const bp = this.bump;
    if (!bp) return 0;
    const p = clamp01((performance.now() - bp.start) / BUMP_MS);
    return bp.kind === 'back' ? bp.from * (1 - easeOut(p)) : bp.from * Math.sin(Math.PI * p) * (1 - p * 0.5);
  }

  /**
   * For the current (possibly mid-motion) view, assign a card to each month that should be visible and position it:
   * the one or two side-by-side cards are centred on the table; extras on the right are tucked under the rightmost card as its pile,
   * and extras on the left are tucked under the leftmost card as the other pile (past months).
   */
  private place(): void {
    if (!this.isConnected) return;
    const { f, b } = this.view;
    const step = this.pitch;
    // With two side by side, shift everything left by half a slot so the pair is centred
    const shift = (-b * step) / 2 + this.nudge();
    // Don't deal cards for months with no selectable days at all
    const lo = Math.max(this.range.minMonth, Math.ceil(f - 1 - EPS));
    const hi = Math.min(this.range.maxMonth, Math.floor(f + b + 1 + EPS));

    for (const [el, k] of this.assigned) if (k < lo || k > hi) this.assigned.delete(el);
    const taken = new Set(this.assigned.values());
    const free = this.pool.filter((el) => !this.assigned.has(el));
    for (let k = lo; k <= hi; k++) {
      if (taken.has(k)) continue;
      const key = keyOf(k);
      const i = free.findIndex((el) => el.month === key);
      const el = free.splice(i >= 0 ? i : free.length - 1, 1)[0];
      if (!el) break;
      this.assigned.set(el, k);
      if (el.month !== key) {
        // Lay it flat before changing month so the calendar can measure its cells and draw ink at normal size
        el.style.transform = 'none';
        el.month = key;
      }
    }

    const rest = !this.moving && this.gesture?.mode !== 'drag';
    for (const el of this.pool) {
      const k = this.assigned.get(el);
      let x = 0;
      let y = 0;
      let opacity = 1;
      let pileSide: 1 | -1 | 0 = 0;
      let onTable = false;
      if (k === undefined) {
        opacity = 0;
      } else {
        const u = k - f;
        if (u < -EPS) {
          // Left: the pile under the leftmost card; invisible with a single card, showing only when spread or when it holds a glowing month
          const d = -u;
          x = shift - d * STACK_DX;
          y = d * STACK_DY;
          if (d > 1 + EPS) opacity = 0;
          else {
            pileSide = -1;
            const glowing = this.months.has(k) || this.pile(k, -1).some((l) => l.glow);
            opacity = glowing ? 1 : clamp01(Math.max(b, 1 - d) * 1.5);
          }
        } else if (u > b + EPS) {
          const d = u - b;
          x = b * step + d * STACK_DX + shift;
          y = d * STACK_DY;
          if (d > 1 + EPS) opacity = 0;
          else pileSide = 1;
        } else {
          x = u * step + shift;
          onTable = true;
        }
        // The further from the table, the lower it sits: both piles tuck under the one or two cards on the table
        el.style.zIndex = String(Math.round(100 - Math.max(-u, u - b, 0) * 10));
        el.toggleAttribute('vignette', k < this.todayIndex);
      }
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity = opacity < 1 ? String(opacity) : '';
      el.classList.toggle('hidden', opacity <= 0);
      el.classList.toggle('inert', !onTable || !rest);
      const shadow =
        pileSide && k !== undefined ? stackShadow(this.pile(k, pileSide), pileSide, this.months.has(k)) : stackShadow([], 1);
      if (this.shadows.get(el) !== shadow) {
        this.shadows.set(el, shadow);
        el.style.boxShadow = shadow;
      }
    }

    // With a single card, the arrows flip the month; once spread, dragging takes over
    const nav = rest && b < 0.5;
    if (nav !== this.navShown) {
      this.navShown = nav;
      for (const el of this.pool) el.toggleAttribute('hide-nav', !nav);
    }
  }

  // ---------- Selection and gestures ----------

  private sync(from: HighlighterCalendar): void {
    this.selection = from.value;
    for (const c of this.pool) if (c !== from) c.value = this.selection;
    this.selectionChanged();
  }

  private selectionChanged(): void {
    this.months = new Set(this.selection.map((d) => monthIndex(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1)));
    if (!this.moving) this.place();
  }

  /** A card changed month by itself (arrow click with a single card, or keyboard moving out of the month): the whole stream follows. */
  private onCardMonth(el: HighlighterCalendar): void {
    const k0 = this.assigned.get(el);
    const k1 = parseKey(el.month);
    if (this.moving || k0 === undefined || k1 === null || k0 === k1) return;
    this.view = { ...this.view, f: this.view.f + (k1 - k0) };
    this.settledView = { ...this.view };
    this.assigned.clear();
    this.assigned.set(el, k1);
    this.place();
    this.emit('monthchange', { month: this.month });
  }

  private emit(type: 'monthchange' | 'spreadchange', detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Blank space: anywhere other than day cells and buttons; on a card, between cards and beside them all count. */
  private isBlank(e: Event): boolean {
    return !e
      .composedPath()
      .some((n) => n instanceof HTMLElement && (n.classList.contains('wrap') || n.localName === 'button'));
  }

  private onDown(e: PointerEvent): void {
    if (this.gesture || (e.pointerType === 'mouse' && e.button !== 0) || !this.isBlank(e)) return;
    this.stopHint();
    this.gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      mode: 'idle',
      base: { ...this.view },
      dir: 0,
      target: null,
      travel: 1,
      rubber: 0,
      samples: [{ t: e.timeStamp, x: e.clientX }],
    };
    try {
      this.$deck.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no real pointer; failing to capture is fine
    }
  }

  private onMove(e: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
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
      const quick = performance.now() - this.lastStep.end < GRACE_MS && this.lastStep.dir === dir;
      if (this.moving || this.bump?.kind === 'back' || quick) {
        g.mode = 'flick';
      } else {
        g.mode = 'drag';
        g.base = { ...this.view };
        this.begin();
        this.$deck.classList.add('busy');
      }
    }

    if (g.mode === 'flick') {
      if (g.dir === 0 && Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= Math.abs(dy) * 1.5) {
        g.dir = dx < 0 ? 1 : -1;
        this.swipe(g.dir);
      }
      return;
    }
    if (g.mode !== 'drag') return;

    // Follow the finger: drag left for next month, right for previous; dragging back past the start switches direction
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    if (dir !== g.dir) {
      g.dir = dir;
      g.target = this.stepTarget(g.base, dir);
      g.travel = g.target ? this.travelOf(g.base, g.target) : 1;
    }
    if (g.target) {
      const p = clamp01(Math.abs(dx) / g.travel);
      this.view = { f: lerp(g.base.f, g.target.f, p), b: lerp(g.base.b, g.target.b, p) };
    } else {
      this.view = { ...g.base };
      g.rubber = Math.sign(dx) * Math.min(RUBBER_MAX, Math.abs(dx) * RUBBER);
    }
    this.place();
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    if (g.mode === 'idle') {
      if (!cancelled && e.timeStamp - g.t < 400) this.tap(e);
      return;
    }
    if (g.mode !== 'drag') return;

    if (!g.target) {
      // Hit the end: spring back on release
      this.view = { ...g.base };
      if (g.rubber) this.bump = { kind: 'back', from: g.rubber, start: performance.now() };
      this.$deck.classList.remove('busy');
      this.place();
      this.kick();
      return;
    }
    const dx = e.clientX - g.x;
    const s0 = g.samples[0];
    const vx = e.timeStamp > s0.t ? (e.clientX - s0.x) / (e.timeStamp - s0.t) : 0;
    const p = clamp01(Math.abs(dx) / g.travel);
    const flung = -Math.sign(vx) === g.dir && Math.abs(vx) > FLICK_SPEED;
    const go = !cancelled && (p >= COMMIT || flung) && !(Math.sign(vx) === g.dir && Math.abs(vx) > FLICK_SPEED);
    const to = go ? g.target : g.base;
    const left = go ? 1 - p : p;
    this.tweenTo(to, go ? g.dir : 0, Math.max(RELEASE_MIN_MS, RELEASE_MS * left), easeOut);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-deck': HighlighterDeck;
  }
  interface HTMLElementEventMap {
    spreadchange: CustomEvent<{ spread: boolean }>;
  }
}
