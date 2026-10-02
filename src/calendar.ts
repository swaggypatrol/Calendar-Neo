import { DEFAULT_THRESHOLD, HighlighterEngine, type DayRect, type FlipEvent, type RowLayout, type Tool } from './engine';
import { InkCanvas, type Run } from './ink';
import { DayRange } from './range';

export interface CalendarChangeDetail {
  /** All selected dates, YYYY-MM-DD, ascending. */
  value: string[];
  added: string[];
  removed: string[];
}

type FlipContext = 'stroke' | 'hold' | 'tap' | 'key' | 'api';

interface PointerState {
  id: number;
  tool: Tool;
  downAt: number;
  downX: number;
  downY: number;
  stillX: number;
  stillY: number;
  stillSince: number;
  moved: boolean;
  holdStarted: boolean;
  startValue: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const dateKey = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

const DEFAULT_INK = '#ffd21f';
/** A second tap on the same day within this long wipes the ink off it. */
const DOUBLE_TAP_MS = 400;
/** How far the coat over the days reaches out beyond them (px), and the rim of light along its edge. */
const COAT_PAD = 4;
const COAT_RIM = 1;

type Pt = [number, number];
interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * The outline (clockwise) of boxes stacked one below another, each overlapping the next: the weeks of a month. Down each
 * side, where two weeks differ in length the step is at the edge of the longer one.
 */
const stairs = (b: Box[]): Pt[] => {
  const same = (x: number, y: number) => Math.abs(x - y) < 0.5;
  const pts: Pt[] = [
    [b[0].l, b[0].t],
    [b[0].r, b[0].t],
  ];
  for (let i = 0; i + 1 < b.length; i++) {
    if (same(b[i].r, b[i + 1].r)) continue;
    const y = b[i].r > b[i + 1].r ? b[i].b : b[i + 1].t;
    pts.push([b[i].r, y], [b[i + 1].r, y]);
  }
  const z = b[b.length - 1];
  pts.push([z.r, z.b], [z.l, z.b]);
  for (let i = b.length - 1; i > 0; i--) {
    if (same(b[i].l, b[i - 1].l)) continue;
    const y = b[i].l < b[i - 1].l ? b[i].t : b[i - 1].b;
    pts.push([b[i].l, y], [b[i - 1].l, y]);
  }
  return pts;
};

/** The same outline moved in by d (its edges all run across or down, so each corner moves in along both). */
const inset = (pts: Pt[], d: number): Pt[] => {
  const n = pts.length;
  // Inward, for an edge going clockwise: its direction turned a quarter clockwise (y runs down)
  const normal = (a: Pt, b: Pt): Pt => [-Math.sign(b[1] - a[1]), Math.sign(b[0] - a[0])];
  return pts.map((p, k) => {
    const a = normal(pts[(k + n - 1) % n], p);
    const b = normal(p, pts[(k + 1) % n]);
    return [p[0] + d * (a[0] + b[0]), p[1] + d * (a[1] + b[1])];
  });
};

/** A closed path through the points, every corner rounded off (as far as the edges either side of it allow). */
const rounded = (pts: Pt[], radius: number): string => {
  const n = pts.length;
  // (a quarter circle, as a cubic)
  const K = 0.5523;
  const f = (v: number) => v.toFixed(1);
  let d = '';
  for (let k = 0; k < n; k++) {
    const [px, py] = pts[(k + n - 1) % n];
    const [x, y] = pts[k];
    const [nx, ny] = pts[(k + 1) % n];
    const l1 = Math.hypot(x - px, y - py) || 1;
    const l2 = Math.hypot(nx - x, ny - y) || 1;
    const r = Math.max(0, Math.min(radius, l1 / 2, l2 / 2));
    const [ux, uy] = [(x - px) / l1, (y - py) / l1];
    const [vx, vy] = [(nx - x) / l2, (ny - y) / l2];
    const [sx, sy] = [x - ux * r, y - uy * r];
    const [ex, ey] = [x + vx * r, y + vy * r];
    d += `${k ? 'L' : 'M'}${f(sx)} ${f(sy)}C${f(sx + ux * r * K)} ${f(sy + uy * r * K)} ${f(ex - vx * r * K)} ${f(ey - vy * r * K)} ${f(ex)} ${f(ey)}`;
  }
  return `${d}Z`;
};

const STYLE = /* css */ `
:host {
  /* Golden proportions, all from the size of the day numbers: a cell is φ² of it tall (so the number is 1/φ² of the cell
     and the highlight band, 1/φ of the cell, is exactly φ times the number), the month title is φ times it, weekday
     letters 1/√φ of it, corners and spacing 1/φ of it */
  --hc-num: 0.875rem;
  --hc-ink: ${DEFAULT_INK};
  --hc-bg: #ffffff;
  --hc-fg: #1d2127;
  --hc-muted: #8a9099;
  --hc-line: rgba(20, 30, 50, 0.07);
  --hc-accent: #e8590c;
  --hc-radius: calc(var(--hc-num) * 0.618);
  --hc-gap: 4px;
  display: inline-block;
  width: 22rem;
  max-width: 100%;
  color: var(--hc-fg);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
/* Dark theme: follows the system unless theme="light"; theme="dark" forces it */
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --hc-bg: #2a2e35;
    --hc-fg: #e8eaed;
    --hc-muted: #8d949e;
    --hc-line: rgba(255, 255, 255, 0.08);
  }
  :host(:not([theme="light"])) .day.selected { color: #1d2127; }
}
:host([theme="dark"]) {
    --hc-bg: #2a2e35;
    --hc-fg: #e8eaed;
    --hc-muted: #8d949e;
    --hc-line: rgba(255, 255, 255, 0.08);
  }
:host([theme="dark"]) .day.selected { color: #1d2127; }
.hc {
  user-select: none;
  -webkit-user-select: none;
  background: var(--hc-bg);
  border-radius: 16px;
  padding: 14px 14px 12px;
  box-sizing: border-box;
}
header {
  user-select: none;
  -webkit-user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px calc(var(--hc-num) * 0.618);
}
.title { font-weight: 650; font-size: calc(var(--hc-num) * 1.618); letter-spacing: -0.01em; }
.nav {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.nav:hover { background: var(--hc-line); }
.nav:disabled { opacity: 0.2; cursor: default; background: transparent; }
.hc.hide-nav .nav { visibility: hidden; }
/* Days already past (and the title of a month that is all past) are printed in grey */
.title.past, .day.past { color: var(--hc-muted); }
.nav:focus-visible { outline: 2px solid var(--hc-accent); }
.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--hc-gap);
  margin-bottom: 4px;
}
.weekdays span { text-align: center; font-size: calc(var(--hc-num) / 1.272); color: var(--hc-muted); }
/* The ink needs room round the grid, but only the days themselves take the pen: a press anywhere else (a blank cell, the
   title, just outside the grid) is not a stroke. In a book, that is where the page is taken hold of to turn it */
.wrap {
  position: relative;
  margin: -14px;
  padding: 14px;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: crosshair;
}
/* A coat laid over the days alone, its edge following them (the weeks' runs of days, the gaps between them included):
   nothing by default; in a book, a glossy varnish (--hc-coat its face, --hc-coat-rim the light along its edge). Shaped
   once the days are laid out; until then it covers nothing */
.coat {
  position: absolute;
  inset: 0;
  pointer-events: none;
  clip-path: var(--coat-edge, inset(50%));
  background: var(--hc-coat-rim, none);
}
.coat::before {
  content: '';
  position: absolute;
  inset: 0;
  clip-path: var(--coat-face, inset(50%));
  background: var(--hc-coat, none);
}
.wrap.brush-cursor { cursor: none; }
canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.grid {
  position: relative;
  pointer-events: none;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--hc-gap);
}
.row { display: contents; }
.day {
  position: relative;
  height: calc(var(--hc-num) * 2.618);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--hc-radius);
  box-shadow: inset 0 0 0 1px var(--hc-line);
  font-size: var(--hc-num);
  font-variant-numeric: tabular-nums;
  outline: none;
}
.day.blank { box-shadow: none; }
/* Each day reaches out over the gap round it (as far as the coat does), so the days and the gaps between them are one
   surface for the pen, the coat's */
.day:not(.blank) { pointer-events: auto; }
.day:not(.blank)::before {
  content: '';
  position: absolute;
  inset: calc(-1 * max(${COAT_PAD}px, var(--hc-gap) / 2 + 1px));
}
.day.disabled {
  color: var(--hc-muted);
  opacity: 0.5;
  box-shadow: none;
  background: repeating-linear-gradient(135deg, transparent 0 6px, var(--hc-line) 6px 7px);
}
.day.selected { font-weight: 650; }
.day.today::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 14.6%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: var(--hc-accent);
}
.day:focus-visible { box-shadow: inset 0 0 0 2px var(--hc-accent); }
.cursor {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  border-radius: 50%;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--hc-ink) 30%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--hc-ink) 75%, #000 25%);
  opacity: 0;
  transition: opacity 0.12s;
}
.cursor.on { opacity: 1; }
.cursor.erase {
  background: rgba(255, 255, 255, 0.35);
  border: 1.5px dashed var(--hc-muted);
  border-radius: 6px;
}
`;

const TEMPLATE = `
<style>${STYLE}</style>
<div class="hc" part="root">
  <header part="header">
    <button class="nav prev" part="nav" type="button">‹</button>
    <div class="title" part="title" aria-live="polite"></div>
    <button class="nav next" part="nav" type="button">›</button>
  </header>
  <div class="weekdays" part="weekdays"></div>
  <div class="wrap">
    <div class="coat" part="coat"></div>
    <canvas></canvas>
    <div class="grid" role="grid"></div>
    <div class="cursor"></div>
  </div>
</div>
`;

/**
 * <highlighter-calendar>: a calendar where you select dates by swiping over them like a highlighter.
 *
 * Attributes: month="2026-09"  threshold="35"  week-start="0|1" (Sunday first by default)  locale="zh-CN"
 *             color="#ffd21f"  tool="highlight|erase"  brush-size="1"  hold-delay="320"
 *             value="2026-09-03,2026-09-04"
 *             min="today"  max="+90" (selectable range: today / tomorrow / +N days / YYYY-MM-DD)
 * Events: input (fires as each day is selected/deselected while drawing), change (on release, if anything changed), monthchange
 */
export class HighlighterCalendar extends HTMLElement {
  static observedAttributes = [
    'month',
    'threshold',
    'week-start',
    'locale',
    'color',
    'tool',
    'brush-size',
    'hold-delay',
    'value',
    'hide-nav',
    'theme',
    'min',
    'max',
  ];

  readonly engine = new HighlighterEngine();
  /** Selectable range; dates outside it are greyed out and the brush has no effect on them. */
  readonly range = new DayRange();

  private ink: InkCanvas;
  private $title: HTMLElement;
  private $weekdays: HTMLElement;
  private $wrap: HTMLElement;
  private $grid: HTMLElement;
  private $coat: HTMLElement;
  private $canvas: HTMLCanvasElement;
  private $cursor: HTMLElement;
  private $prev: HTMLButtonElement;
  private $next: HTMLButtonElement;

  private year: number;
  private month0: number;
  private weekStart = 0;
  private locale: string | undefined;
  private _tool: Tool = 'highlight';
  private _color = DEFAULT_INK;
  private holdDelay = 320;

  private dayEls = new Map<string, HTMLElement>();
  private cells: HTMLElement[] = [];
  private ptr: PointerState | null = null;
  private lastTap: { key: string; t: number } | null = null;
  private flipCtx: FlipContext = 'api';
  private tapY = 0;
  private pendingComplete = new Set<string>();
  private raf = 0;
  private lastT = 0;
  private size = { w: 0, h: 0, dpr: 0 };
  private gap = 4;
  /** The coat's outline as last laid over the days. */
  private coatEdge = '';
  private focusKey: string | null = null;
  private ro: ResizeObserver | null = null;
  private dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.$title = q('.title');
    this.$weekdays = q('.weekdays');
    this.$wrap = q('.wrap');
    this.$grid = q('.grid');
    this.$coat = q('.coat');
    this.$canvas = q('canvas');
    this.$cursor = q('.cursor');
    this.$prev = q('.prev');
    this.$next = q('.next');
    this.ink = new InkCanvas(this.$canvas);
    this.engine.onFlip = (e) => this.handleFlip(e);
    this.engine.isDisabled = (key) => !this.range.allows(key);
    this.updateBoost();
    this.dark?.addEventListener('change', () => this.updateBoost());

    const now = new Date();
    this.year = now.getFullYear();
    this.month0 = now.getMonth();

    this.$prev.addEventListener('click', () => this.shiftMonth(-1));
    this.$next.addEventListener('click', () => this.shiftMonth(1));
    const w = this.$wrap;
    w.addEventListener('pointerdown', (e) => this.onDown(e));
    w.addEventListener('pointermove', (e) => this.onMove(e));
    w.addEventListener('pointerup', (e) => this.onUp(e, false));
    w.addEventListener('pointercancel', (e) => this.onUp(e, true));
    w.addEventListener('pointerleave', () => this.$cursor.classList.remove('on'));
    w.addEventListener('contextmenu', (e) => e.preventDefault());
    this.$grid.addEventListener('keydown', (e) => this.onKey(e));
    this.$grid.addEventListener('focusin', (e) => {
      const key = (e.target as HTMLElement).dataset?.key;
      if (key) this.setFocusKey(key);
    });
  }

  connectedCallback(): void {
    // An already-drawn calendar moved into another container (e.g. onto the back of a page mid-turn): don't re-render, keep the
    // hand-drawn ink, and don't measure here either (that would force a layout in the middle of an animation frame); the
    // resize observer's first callback measures it once the browser has laid it out anyway
    if (!this.cells.length) this.render();
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.$wrap);
  }

  disconnectedCallback(): void {
    this.ro?.disconnect();
    this.ro = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    switch (name) {
      case 'month':
        if (v) this.month = v;
        break;
      case 'threshold':
        this.threshold = v === null ? DEFAULT_THRESHOLD : Number(v);
        break;
      case 'week-start':
        this.weekStart = v === null ? 0 : ((Number(v) % 7) + 7) % 7 || 0;
        this.render();
        break;
      case 'locale':
        this.locale = v ?? undefined;
        this.render();
        break;
      case 'color':
        this.color = v ?? DEFAULT_INK;
        break;
      case 'tool':
        this.tool = v === 'erase' ? 'erase' : 'highlight';
        break;
      case 'brush-size':
        this.engine.brushScale = Math.min(2, Math.max(0.5, Number(v) || 1));
        this.measure(true);
        break;
      case 'hold-delay':
        this.holdDelay = Math.max(80, Number(v) || 320);
        break;
      case 'theme':
        this.updateBoost();
        break;
      case 'hide-nav':
        this.shadowRoot!.querySelector('.hc')!.classList.toggle('hide-nav', v !== null);
        break;
      case 'value':
        this.value = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'min':
      case 'max':
        this.range.set(name, v);
        this.applyRange();
        break;
    }
  }

  /** Dark backgrounds make translucent yellow look muddy, so the ink is drawn twice there. */
  private updateBoost(): void {
    const t = this.getAttribute('theme');
    this.ink.boost = t === 'dark' || (t !== 'light' && !!this.dark?.matches);
    this.kick();
  }

  // ---------- Public API ----------

  /** Selected dates (YYYY-MM-DD, ascending). Need not be contiguous, and may span months. */
  get value(): string[] {
    return this.engine.value;
  }

  set value(keys: string[]) {
    const visible = [...this.dayEls.keys()];
    const shown = () => visible.filter((k) => this.engine.isSelected(k)).join();
    const before = shown();
    this.engine.setSelection(keys);
    // Visible dates in this month are unchanged (e.g. another month's card changed the selection): don't redraw, keep the hand-drawn ink
    if (shown() === before) return;
    this.syncDom();
    this.measure(true);
  }

  /** How many sub-cells (out of 64) must be painted for a day to count as selected; default 35. */
  get threshold(): number {
    return this.engine.threshold;
  }

  set threshold(n: number) {
    this.engine.threshold = Number.isFinite(n) ? n : DEFAULT_THRESHOLD;
  }

  /** Month currently shown, as YYYY-MM. */
  get month(): string {
    return `${this.year}-${pad2(this.month0 + 1)}`;
  }

  set month(v: string) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(v);
    if (!m) return;
    const k = this.clampMonth(Number(m[1]) * 12 + Math.min(11, Math.max(0, Number(m[2]) - 1)));
    this.year = Math.floor(k / 12);
    this.month0 = k % 12;
    this.render();
  }

  /** Earliest selectable date (YYYY-MM-DD), or null if unbounded. */
  get min(): string | null {
    return this.range.min;
  }

  set min(v: string | null) {
    if (v === null) this.removeAttribute('min');
    else this.setAttribute('min', v);
  }

  /** Latest selectable date (YYYY-MM-DD), or null if unbounded. */
  get max(): string | null {
    return this.range.max;
  }

  set max(v: string | null) {
    if (v === null) this.removeAttribute('max');
    else this.setAttribute('max', v);
  }

  /** Tool for left click / touch. Right click and a pen's eraser end always erase. */
  get tool(): Tool {
    return this._tool;
  }

  set tool(t: Tool) {
    this._tool = t;
    this.$cursor.classList.toggle('erase', t === 'erase');
  }

  get color(): string {
    return this._color;
  }

  set color(c: string) {
    this._color = c;
    this.style.setProperty('--hc-ink', c);
    this.ink.setColor(c);
    this.kick();
  }

  /** Clear the whole selection (with a fade-out). silent=true suppresses the change event. */
  clear(silent = false): void {
    const before = this.value;
    if (!before.length) return;
    this.engine.setSelection([]);
    this.syncDom();
    this.updateRuns();
    this.ink.prune();
    if (!silent) this.emit('change', before);
    this.kick();
  }

  shiftMonth(delta: number): void {
    const cur = this.year * 12 + this.month0;
    const k = this.clampMonth(cur + delta);
    if (k === cur) return;
    this.year = Math.floor(k / 12);
    this.month0 = k % 12;
    this.render();
    this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  /** Month navigation can't land on a month with no selectable days at all. */
  private clampMonth(k: number): number {
    return Math.min(this.range.maxMonth, Math.max(this.range.minMonth, k));
  }

  /** min / max changed: drop selected dates outside the range and move to a selectable month if needed. */
  private applyRange(): void {
    const before = this.value;
    this.engine.setSelection(before);
    const cur = this.year * 12 + this.month0;
    const k = this.clampMonth(cur);
    this.year = Math.floor(k / 12);
    this.month0 = k % 12;
    this.render();
    if (this.isConnected) this.emit('change', before);
  }

  // ---------- Rendering ----------

  private render(): void {
    // Relative values like "today" are re-resolved on every render, so a page left open overnight stays correct
    this.range.refresh();
    const { year: y, month0: m } = this;
    const k = y * 12 + m;
    this.$prev.disabled = k <= this.range.minMonth;
    this.$next.disabled = k >= this.range.maxMonth;
    const fmt = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' });
    this.$title.textContent = fmt.format(new Date(y, m, 1));
    const now0 = new Date();
    this.$title.classList.toggle('past', k < now0.getFullYear() * 12 + now0.getMonth());
    this.$grid.setAttribute('aria-label', this.$title.textContent);

    const wd = new Intl.DateTimeFormat(this.locale, { weekday: 'narrow' });
    this.$weekdays.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('span');
      // 2023-01-01 was a Sunday
      s.textContent = wd.format(new Date(2023, 0, 1 + ((this.weekStart + i) % 7)));
      this.$weekdays.append(s);
    }

    const offset = (new Date(y, m, 1).getDay() - this.weekStart + 7) % 7;
    const dim = new Date(y, m + 1, 0).getDate();
    const now = new Date();
    const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
    const label = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

    this.$grid.innerHTML = '';
    this.dayEls.clear();
    this.cells = [];
    let row: HTMLElement | null = null;
    for (let i = 0; i < 42; i++) {
      if (i % 7 === 0) {
        row = document.createElement('div');
        row.className = 'row';
        row.setAttribute('role', 'row');
        this.$grid.append(row);
      }
      const d = i - offset + 1;
      const el = document.createElement('div');
      el.className = 'day';
      el.setAttribute('role', 'gridcell');
      if (d < 1 || d > dim) {
        el.classList.add('blank');
        el.setAttribute('aria-hidden', 'true');
      } else {
        const key = dateKey(y, m, d);
        el.dataset.key = key;
        el.tabIndex = -1;
        el.setAttribute('aria-label', label.format(new Date(y, m, d)));
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = String(d);
        el.append(num);
        if (key === todayKey) el.classList.add('today');
        else if (key < todayKey) el.classList.add('past');
        if (!this.range.allows(key)) {
          el.classList.add('disabled');
          el.setAttribute('aria-disabled', 'true');
        }
        this.dayEls.set(key, el);
      }
      this.cells.push(el);
      row!.append(el);
    }
    this.syncDom();

    const keys = [...this.dayEls.keys()];
    const first =
      keys.find((k) => this.engine.isSelected(k)) ??
      (this.dayEls.has(todayKey) && this.range.allows(todayKey) ? todayKey : keys.find((k) => this.range.allows(k)) ?? keys[0]);
    this.setFocusKey(first);
    this.measure(true);
  }

  private syncDom(): void {
    for (const [key, el] of this.dayEls) {
      const sel = this.engine.isSelected(key);
      el.classList.toggle('selected', sel);
      el.setAttribute('aria-selected', String(sel));
    }
  }

  private setFocusKey(key: string): void {
    if (this.focusKey) this.dayEls.get(this.focusKey)?.setAttribute('tabindex', '-1');
    this.focusKey = key;
    this.dayEls.get(key)?.setAttribute('tabindex', '0');
  }

  /** Measure each day cell's position and hand it to the engine; redraw the ink if the size changed (or force). */
  private measure(force = false): void {
    if (!this.isConnected || this.ptr) return;
    const box = this.$wrap.getBoundingClientRect();
    if (box.width === 0) return;
    // Mid 3D flip (a page being turned): the measurement is a projection and unusable; wait until it lies flat
    const c0 = this.cells[0].getBoundingClientRect();
    const c1 = this.cells[1].getBoundingClientRect();
    if (c1.left < c0.left || Math.abs(box.width - this.$wrap.offsetWidth) > 1) return;
    const dpr = window.devicePixelRatio || 1;
    const resized = box.width !== this.size.w || box.height !== this.size.h || dpr !== this.size.dpr;
    if (resized) {
      this.size = { w: box.width, h: box.height, dpr };
      this.ink.resize(box.width, box.height, dpr);
      this.ink.setColor(this._color);
    }

    const rows: RowLayout[] = [];
    for (let r = 0; r < 6; r++) {
      const rc = this.cells[r * 7].getBoundingClientRect();
      const row: RowLayout = { top: rc.top - box.top, bottom: rc.bottom - box.top, days: [] };
      for (let c = 0; c < 7; c++) {
        const el = this.cells[r * 7 + c];
        const key = el.dataset.key;
        if (!key) continue;
        const b = el.getBoundingClientRect();
        row.days.push({
          key,
          slot: c,
          left: b.left - box.left,
          top: b.top - box.top,
          right: b.right - box.left,
          bottom: b.bottom - box.top,
        });
      }
      rows.push(row);
    }
    const a = this.cells[0].getBoundingClientRect();
    const b = this.cells[1].getBoundingClientRect();
    this.gap = Math.max(0, b.left - a.right);
    this.shapeCoat(rows);
    this.engine.setLayout(rows);
    this.ink.setBlocked(rows.flatMap((r) => r.days).filter((d) => this.engine.disabled(d.key)));
    this.updateRuns();

    if (resized || force) {
      this.ink.clear();
      this.paintStatic();
    }
    this.kick();
  }

  /**
   * Lay the coat over the days: round each week's run of days and out to COAT_PAD beyond them (over the gaps too), the
   * weeks joined into one shape, its corners rounded like a day's; its face COAT_RIM inside that, leaving the rim.
   */
  private shapeCoat(rows: RowLayout[]): void {
    const weeks = rows.filter((r) => r.days.length);
    if (!weeks.length) return;
    const pad = this.coatPad;
    const outline = stairs(
      weeks.map((w) => ({ l: w.days[0].left - pad, r: w.days[w.days.length - 1].right + pad, t: w.top - pad, b: w.bottom + pad })),
    );
    // (a day's corners are 1/φ of the number, and the number 1/φ² of the day: 0.236 of its height)
    const radius = (weeks[0].bottom - weeks[0].top) * 0.236 + pad;
    const edge = rounded(outline, radius);
    // (measured again at every press: unchanged, leave it be)
    if (edge === this.coatEdge) return;
    this.coatEdge = edge;
    this.$coat.style.setProperty('--coat-edge', `path('${edge}')`);
    this.$coat.style.setProperty('--coat-face', `path('${rounded(inset(outline, COAT_RIM), radius - COAT_RIM)}')`);
  }

  /** How far the coat reaches out beyond the days: COAT_PAD, or further if the gaps between them are wider. */
  private get coatPad(): number {
    return Math.max(COAT_PAD, this.gap / 2 + 1);
  }

  /**
   * Whether a point on the screen is on the coat over the days, the only place a stroke can start. It is the place that
   * counts, not the element there: the browser can put a touch just beside a day onto it (in a book, that is paper for
   * turning the page).
   */
  onCoat(clientX: number, clientY: number): boolean {
    const b = this.$wrap.getBoundingClientRect();
    const [x, y] = [clientX - b.left, clientY - b.top];
    const pad = this.coatPad;
    return this.engine.layout.some(
      (r) =>
        r.days.length > 0 &&
        y >= r.top - pad &&
        y <= r.bottom + pad &&
        x >= r.days[0].left - pad &&
        x <= r.days[r.days.length - 1].right + pad,
    );
  }

  /** Selected regions: consecutive selected days in the same row joined into one run. */
  private runs(): (Run & { days: DayRect[] })[] {
    const out: (Run & { days: DayRect[] })[] = [];
    for (const row of this.engine.layout) {
      let cur: (Run & { days: DayRect[] }) | null = null;
      let lastSlot = -2;
      for (const d of row.days) {
        if (!this.engine.isSelected(d.key)) {
          cur = null;
          continue;
        }
        if (cur && d.slot === lastSlot + 1) {
          cur.right = d.right;
          cur.days.push(d);
        } else {
          cur = { left: d.left, right: d.right, top: d.top, bottom: d.bottom, days: [d] };
          out.push(cur);
        }
        lastSlot = d.slot;
      }
    }
    return out;
  }

  private updateRuns(): void {
    this.ink.setRuns(this.runs(), this.gap * 0.9 + 1);
  }

  /**
   * The narrow band where ink finally settles: vertically centred on the day number, 0.618 of the cell height.
   * You can paint anywhere in the cell while drawing; on release the stroke drifts into this band so everything looks neat and uniform.
   */
  private band(r: { top: number; bottom: number }): { cy: number; half: number } {
    return { cy: (r.top + r.bottom) / 2, half: (r.bottom - r.top) * 0.309 };
  }

  /** Paint ink for all selected days without animation (on month change, resize, or programmatic value). */
  private paintStatic(): void {
    for (const run of this.runs()) {
      const { cy, half } = this.band(run);
      const rise = (run.bottom - run.top) * 0.03;
      this.ink.sweep(run.left - 3, cy + rise / 2, run.right + 3, cy - rise / 2, half, false);
    }
  }

  /** Automatically sweep one stroke across a day (within the band). dir=1 left to right, -1 right to left. */
  private sweepDay(r: DayRect, _y: number, dir: 1 | -1, delay = 0): void {
    const { cy: yc, half: ry } = this.band(r);
    const h = r.bottom - r.top;
    const rise = h * 0.035;
    const xl = r.left - 3;
    const xr = r.right + 3;
    if (dir > 0) this.ink.sweep(xl, yc + rise / 2, xr, yc - rise / 2, ry, true, delay);
    else this.ink.sweep(xr, yc - rise / 2, xl, yc + rise / 2, ry, true, delay);
  }

  private handleFlip(e: FlipEvent): void {
    const el = this.dayEls.get(e.key);
    if (el) {
      el.classList.toggle('selected', e.selected);
      el.setAttribute('aria-selected', String(e.selected));
    }
    this.updateRuns();
    const st = this.engine.state(e.key);
    if (st) {
      const r = st.rect;
      if (!e.selected) {
        this.pendingComplete.delete(e.key);
        this.ink.prune();
      } else if (this.flipCtx === 'stroke') {
        this.pendingComplete.add(e.key);
      } else if (this.flipCtx === 'hold') {
        // Pen held still too long: from where it stopped, sweep one stroke in the most natural direction
        const hp = this.engine.holdPoint;
        const dir = hp && hp.x > r.right ? -1 : 1;
        this.sweepDay(r, hp?.y ?? (r.top + r.bottom) / 2, dir);
      } else if (this.flipCtx === 'tap') {
        this.sweepDay(r, this.tapY, 1);
      } else {
        this.sweepDay(r, (r.top + r.bottom) / 2, 1);
      }
    }
    this.dispatchEvent(
      new CustomEvent<CalendarChangeDetail>('input', {
        detail: { value: this.value, added: e.selected ? [e.key] : [], removed: e.selected ? [] : [e.key] },
        bubbles: true,
        composed: true,
      }),
    );
    this.kick();
  }

  /** After release: for selected days that weren't fully covered, finish the stroke in its original direction. */
  private completeStrokes(): void {
    for (const key of this.pendingComplete) {
      const st = this.engine.state(key);
      if (!st || !st.selected) continue;
      const r = st.rect;
      const cov = this.engine.coverage.get(key);
      if (!cov) {
        this.sweepDay(r, (r.top + r.bottom) / 2, 1);
        continue;
      }
      const { rx } = this.engine.brushRadius(r);
      const { cy: y, half: ry } = this.band(r);
      const w = r.right - r.left;
      if (cov.maxX + rx < r.right - w * 0.1) this.ink.sweep(cov.maxX, y, r.right + 3, y - 1, ry, true);
      if (cov.minX - rx > r.left + w * 0.1) this.ink.sweep(cov.minX, y, r.left - 3, y - 1, ry, true);
    }
    this.pendingComplete.clear();
  }

  private emit(type: 'change', before: string[]): void {
    const now = this.value;
    const b = new Set(before);
    const n = new Set(now);
    const added = now.filter((k) => !b.has(k));
    const removed = before.filter((k) => !n.has(k));
    if (!added.length && !removed.length) return;
    this.dispatchEvent(
      new CustomEvent<CalendarChangeDetail>(type, {
        detail: { value: now, added, removed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------- Pointer ----------

  private local(e: PointerEvent): { x: number; y: number } {
    const b = this.$wrap.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  private onDown(e: PointerEvent): void {
    if (this.ptr) return;
    const eraser = e.button === 2 || e.button === 5;
    if (e.pointerType === 'mouse' && e.button !== 0 && !eraser) return;
    this.measure();
    if (!this.onCoat(e.clientX, e.clientY)) return;
    e.preventDefault();
    const tool: Tool = eraser ? 'erase' : this._tool;
    const { x, y } = this.local(e);
    const r0 = this.engine.layout[0]?.days[0];
    if (!r0) return;
    try {
      this.$wrap.setPointerCapture(e.pointerId);
    } catch {
      // No capture for synthetic events without a real pointer; painting still works
    }
    this.ptr = {
      id: e.pointerId,
      tool,
      downAt: e.timeStamp,
      downX: x,
      downY: y,
      stillX: x,
      stillY: y,
      stillSince: e.timeStamp,
      moved: false,
      holdStarted: false,
      startValue: this.value,
    };
    this.ink.beginLive(tool, x, y, e.timeStamp, this.engine.brushRadius(r0).ry);
    this.flipCtx = 'stroke';
    this.engine.beginStroke(tool, x, y);
    this.updateCursor(e);
    this.kick();
  }

  private onMove(e: PointerEvent): void {
    this.updateCursor(e);
    const p = this.ptr;
    if (!p || e.pointerId !== p.id) return;
    const list = e.getCoalescedEvents?.() ?? [];
    for (const ev of list.length ? list : [e]) {
      const { x, y } = this.local(ev);
      if (Math.hypot(x - p.stillX, y - p.stillY) > 4) {
        p.stillX = x;
        p.stillY = y;
        p.stillSince = ev.timeStamp;
        if (p.holdStarted) {
          this.engine.cancelHold();
          p.holdStarted = false;
        }
      }
      if (Math.hypot(x - p.downX, y - p.downY) > 6) p.moved = true;
      this.flipCtx = 'stroke';
      this.engine.moveTo(x, y);
      this.ink.liveTo(x, y, ev.timeStamp);
    }
    this.kick();
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const p = this.ptr;
    if (!p || e.pointerId !== p.id) return;
    const { x, y } = this.local(e);
    const tap = !cancelled && !p.moved && !p.holdStarted && e.timeStamp - p.downAt < this.holdDelay;
    if (tap) {
      // Tap: like a drop of ink, the day is selected with a single sweep (right click erases it). Tapping the same day
      // again straight away wipes the ink off it: the way to erase with a finger
      const key = this.dayAt(x, y);
      const again = !!key && this.lastTap?.key === key && e.timeStamp - this.lastTap.t < DOUBLE_TAP_MS;
      this.lastTap = key && !again ? { key, t: e.timeStamp } : null;
      this.flipCtx = 'tap';
      this.tapY = y;
      if (again) this.engine.setDay(key!, false);
      else this.engine.tap(x, y);
    } else this.lastTap = null;
    this.flipCtx = 'stroke';
    this.engine.endStroke();
    this.ink.endLive(!tap);
    this.completeStrokes();
    if (p.tool === 'highlight') {
      this.ink.prune();
      // Pen lifted: strokes drift into their row's narrow band
      // Only the runs this stroke touched move; runs that already settled aren't darkened again
      const touched = this.engine.coverage;
      this.ink.settle(
        this.runs()
          .filter((run) => run.days.some((d) => touched.has(d.key)))
          .map((run) => ({ ...run, ...this.band(run) })),
      );
    }
    this.ptr = null;
    this.flipCtx = 'api';
    this.emit('change', p.startValue);
    this.kick();
  }

  /** The day under a point (in the wrap's coordinates), if any. */
  private dayAt(x: number, y: number): string | null {
    for (const row of this.engine.layout) {
      if (y < row.top || y > row.bottom) continue;
      for (const d of row.days) if (x >= d.left && x <= d.right) return d.key;
    }
    return null;
  }

  private updateCursor(e: PointerEvent): void {
    const c = this.$cursor;
    if (e.pointerType === 'touch') {
      c.classList.remove('on');
      this.$wrap.classList.remove('brush-cursor');
      return;
    }
    const r0 = this.engine.layout[0]?.days[0];
    if (!r0) return;
    const { rx, ry } = this.engine.brushRadius(r0);
    const { x, y } = this.local(e);
    const erase = this.ptr ? this.ptr.tool === 'erase' : this._tool === 'erase' || (e.buttons & 2) !== 0;
    c.classList.toggle('erase', erase);
    const w = erase ? ry : rx * 2;
    c.style.width = `${w}px`;
    c.style.height = `${ry * 2}px`;
    c.style.transform = `translate(${x - w / 2}px, ${y - ry}px) rotate(8deg)`;
    c.classList.add('on');
    this.$wrap.classList.add('brush-cursor');
  }

  // ---------- Keyboard ----------

  private onKey(e: KeyboardEvent): void {
    const key = this.focusKey;
    if (!key) return;
    const [y, m, d] = key.split('-').map(Number);
    const move = (days: number) => {
      const t = new Date(y, m - 1, d + days);
      const k = dateKey(t.getFullYear(), t.getMonth(), t.getDate());
      if (!this.range.allows(k)) return;
      if (t.getMonth() !== this.month0 || t.getFullYear() !== this.year) {
        this.shiftMonth(t.getFullYear() * 12 + t.getMonth() - (this.year * 12 + this.month0));
      }
      this.setFocusKey(k);
      this.dayEls.get(k)?.focus();
    };
    switch (e.key) {
      case 'ArrowLeft':
        move(-1);
        break;
      case 'ArrowRight':
        move(1);
        break;
      case 'ArrowUp':
        move(-7);
        break;
      case 'ArrowDown':
        move(7);
        break;
      case 'PageUp':
        this.shiftMonth(-1);
        break;
      case 'PageDown':
        this.shiftMonth(1);
        break;
      case 'Enter':
      case ' ': {
        const before = this.value;
        this.flipCtx = 'key';
        this.engine.setDay(key, !this.engine.isSelected(key));
        this.flipCtx = 'api';
        this.emit('change', before);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  }

  // ---------- Animation loop ----------

  private kick(): void {
    if (!this.raf && this.isConnected) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    this.raf = 0;
    const dt = this.lastT ? Math.min(50, t - this.lastT) : 16;
    this.lastT = t;
    const p = this.ptr;
    if (p) {
      const still = t - p.stillSince;
      // Held still: ink slowly bleeds and darkens under the pen tip
      if (still > 140) this.ink.pool(p.stillX, p.stillY, dt);
      if (!p.holdStarted && still >= this.holdDelay) {
        this.engine.startHold(p.stillX, p.stillY);
        p.holdStarted = true;
      }
      this.flipCtx = 'hold';
      this.engine.tick(dt);
      this.flipCtx = 'stroke';
    }
    const busy = this.ink.frame(dt);
    if (p || busy) this.kick();
    else this.lastT = 0;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-calendar': HighlighterCalendar;
  }
  interface HTMLElementEventMap {
    monthchange: CustomEvent<{ month: string }>;
  }
}
