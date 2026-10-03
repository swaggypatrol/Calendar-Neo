import { DayRange, monthIndexOf } from './range';
import { DIGITS, SLOTS, displayChars, keyOf, monthSlots } from './keypad';

/* ---------- Filament display geometry (SVG user units) ---------- */

/** One digit cell, and the room between digits and before each decimal point. */
const DW = 30;
const DH = 54;
const STEP = DW + 8;
const DOT = 10;
/** Left edge of each of the eight digits: YYYY . MM . DD */
const digitX = (i: number) => i * STEP + (i >= 4 ? DOT : 0) + (i >= 6 ? DOT : 0);
const VIEW_W = digitX(7) + DW;

/**
 * Each segment is one straight filament strung between two posts, as in a Numitron tube, sagging very slightly
 * under its own weight (horizontal wires) or bowing a hair (vertical ones).
 */
const SEG: Record<string, [number, number, number, number]> = {
  a: [5, 3, 25, 3],
  b: [27, 5, 27, 25],
  c: [27, 29, 27, 49],
  d: [5, 51, 25, 51],
  e: [3, 29, 3, 49],
  f: [3, 5, 3, 25],
  g: [5, 27, 25, 27],
};

const wire = (x1: number, y1: number, x2: number, y2: number): string => {
  const horizontal = y1 === y2;
  const mx = (x1 + x2) / 2 + (horizontal ? 0 : 0.45);
  const my = (y1 + y2) / 2 + (horizontal ? 1.1 : 0);
  return `M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`;
};

/** A segment drawn three times: the cold wire you can always see, its orange bloom, and the white-hot core. */
const filament = (d: string, cls: string) =>
  `<g class="seg ${cls}"><path class="cold" d="${d}"/><path class="glow" d="${d}" filter="url(#bloom)"/><path class="core" d="${d}"/></g>`;

function displaySvg(): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    const x = digitX(i);
    s += `<g class="digit" transform="translate(${x} 0)">`;
    for (const [name, [x1, y1, x2, y2]] of Object.entries(SEG)) s += filament(wire(x1, y1, x2, y2), `s-${name}`);
    s += '</g>';
    if (i === 3 || i === 5) {
      const cx = x + DW + DOT / 2 + 1;
      s += filament(`M${cx - 1.6} 51L${cx + 1.6} 51`, 'dp');
    }
  }
  return (
    `<svg class="digits" viewBox="-4 -4 ${VIEW_W + 8} ${DH + 8}" aria-hidden="true">` +
    `<defs><filter id="bloom" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>` +
    `${s}</svg>`
  );
}

/* ---------- Words on the faceplate, in the reader's language ---------- */

const WORDS: Record<string, { today: string; prev: string; next: string; clear: string; none: string }> = {
  en: { today: 'Today', prev: 'Previous month', next: 'Next month', clear: 'Clear', none: 'No date chosen' },
  ja: { today: '今日', prev: '前の月', next: '次の月', clear: 'クリア', none: '日付が選ばれていません' },
  zh: { today: '今天', prev: '上个月', next: '下个月', clear: '清除', none: '尚未选择日期' },
};

const STYLE = /* css */ `
:host {
  --rc-width: 22rem;
  display: inline-block;
  width: var(--rc-width);
  max-width: 100%;
  -webkit-tap-highlight-color: transparent;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "PingFang SC", "Microsoft YaHei", sans-serif;

  /* Light: a cream-and-taupe desk calculator */
  --shell-hi: #eee8dc;
  --shell: #ded5c4;
  --shell-lo: #c9bfac;
  --print: #74695a;
  --well: #b5aa96;
  --cap-hi: #fffdf8;
  --cap: #f4eee2;
  --cap-lo: #e2dacb;
  --wall: #bdb19c;
  --legend: #34302b;
  --sun: #c23a2b;
  --sat: #2a5fae;
  --muted: #a39a8b;
  --fn-hi: #6b665f;
  --fn: #57524b;
  --fn-lo: #48443e;
  --fn-wall: #2f2c28;
  --fn-legend: #f1ebdf;
  --hot-hi: #f5874a;
  --hot: #e4652d;
  --hot-lo: #cf5520;
  --hot-wall: #94391a;
  --drop: rgba(60, 45, 25, 0.32);
  --amber: #ffb347;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --shell-hi: #36373b;
    --shell: #2a2b2f;
    --shell-lo: #202124;
    --print: #8f8a82;
    --well: #151618;
    --cap-hi: #55575d;
    --cap: #46484d;
    --cap-lo: #3a3c41;
    --wall: #222327;
    --legend: #eeebe5;
    --sun: #ff8070;
    --sat: #86b4ff;
    --muted: #7a7873;
    --fn-hi: #2f3034;
    --fn: #26272a;
    --fn-lo: #1f2023;
    --fn-wall: #0d0d0f;
    --fn-legend: #e6e1d7;
    --hot-wall: #6e2a12;
    --drop: rgba(0, 0, 0, 0.55);
  }
}
:host([theme="dark"]) {
  --shell-hi: #36373b;
  --shell: #2a2b2f;
  --shell-lo: #202124;
  --print: #8f8a82;
  --well: #151618;
  --cap-hi: #55575d;
  --cap: #46484d;
  --cap-lo: #3a3c41;
  --wall: #222327;
  --legend: #eeebe5;
  --sun: #ff8070;
  --sat: #86b4ff;
  --muted: #7a7873;
  --fn-hi: #2f3034;
  --fn: #26272a;
  --fn-lo: #1f2023;
  --fn-wall: #0d0d0f;
  --fn-legend: #e6e1d7;
  --hot-wall: #6e2a12;
  --drop: rgba(0, 0, 0, 0.55);
}

.shell {
  container-type: inline-size;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  /* The key travel, and everything else, scales with the calculator's width */
  --t: 1.5cqi;
  padding: 5cqi 5cqi 4.5cqi;
  border-radius: 7cqi;
  background:
    radial-gradient(140% 70% at 30% 0%, var(--shell-hi), transparent 60%),
    linear-gradient(180deg, var(--shell), var(--shell-lo));
  box-shadow:
    inset 0 0.4cqi 0 rgba(255, 255, 255, 0.35),
    inset 0 -0.8cqi 1.6cqi rgba(0, 0, 0, 0.12),
    0 1cqi 2cqi var(--drop),
    0 4cqi 8cqi -2cqi var(--drop);
}

/* ---------- Top: maker's mark and a solar strip, then the display ---------- */
.mark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 1cqi 3cqi;
  color: var(--print);
  font-size: 2.6cqi;
  font-weight: 700;
  letter-spacing: 0.28em;
}
.mark small { font-weight: 500; letter-spacing: 0.12em; opacity: 0.8; }
.solar {
  display: flex;
  gap: 0.5cqi;
  padding: 0.6cqi;
  border-radius: 1.2cqi;
  background: #3a2b22;
  box-shadow: inset 0 0.3cqi 0.6cqi rgba(0, 0, 0, 0.6), 0 0.2cqi 0 rgba(255, 255, 255, 0.35);
}
.solar i {
  width: 4.2cqi;
  height: 3.2cqi;
  border-radius: 0.4cqi;
  background: linear-gradient(160deg, #6a4a3a, #3d2a22 55%, #2c1e18);
}

.window {
  position: relative;
  overflow: hidden;
  padding: 4cqi 4.5cqi 2.6cqi;
  border-radius: 3cqi;
  background:
    radial-gradient(90% 120% at 50% 40%, #2a1408 0%, #160a04 60%, #0c0603 100%);
  box-shadow:
    inset 0 0.8cqi 2cqi rgba(0, 0, 0, 0.85),
    inset 0 -0.3cqi 0.6cqi rgba(255, 140, 60, 0.06),
    0 0 0 0.9cqi #1d1a17,
    0 0 0 1.2cqi rgba(255, 255, 255, 0.18),
    0 0.6cqi 1.4cqi 0.9cqi rgba(0, 0, 0, 0.35);
}
/* The glass: a soft diagonal reflection over the tubes */
.window::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(168deg, rgba(255, 255, 255, 0.11) 0%, rgba(255, 255, 255, 0.03) 38%, transparent 38.5%),
    radial-gradient(60% 40% at 80% 110%, rgba(255, 255, 255, 0.04), transparent);
}
.digits { display: block; width: 100%; height: auto; overflow: visible; }
.seg path { fill: none; stroke-linecap: round; }
.cold { stroke: #4b2c18; stroke-width: 1.1; opacity: 0.75; }
.glow {
  stroke: #ff6c12;
  stroke-width: 5.5;
  opacity: 0;
  /* A filament cools slower than it heats: the bloom lingers a moment, reddening, after the core goes dark */
  transition: opacity 0.55s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.core {
  stroke: #ffe0a0;
  stroke-width: 1.9;
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.seg.on .glow { opacity: 0.85; transition: opacity 0.16s ease-in; }
.seg.on .core { opacity: 1; transition: opacity 0.1s ease-in; }
.seg.dim .glow { opacity: 0.35; transition: opacity 0.2s ease-in; }
.seg.dim .core { opacity: 0.45; transition: opacity 0.14s ease-in; }

.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-top: 2.2cqi;
  text-align: center;
  font-size: 2.3cqi;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.days span {
  color: rgba(255, 130, 50, 0.13);
  transition: color 0.5s cubic-bezier(0.2, 0.6, 0.3, 1), text-shadow 0.5s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.days span.on {
  color: #ffd38a;
  text-shadow: 0 0 0.6cqi #ff8a1c, 0 0 1.8cqi rgba(255, 110, 20, 0.7);
  transition-duration: 0.14s;
}

/* ---------- The function row and the month printed on the plate ---------- */
.fn {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2cqi;
  align-items: center;
  margin: 5cqi 0 1.4cqi;
}
.month {
  grid-column: span 3;
  position: relative;
  overflow: hidden;
  height: 6cqi;
  text-align: center;
  color: var(--legend);
}
.month span {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  white-space: nowrap;
  font-size: 3.7cqi;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2cqi;
  margin: 2.6cqi 0 1.2cqi;
  text-align: center;
  color: var(--print);
  font-size: 2.5cqi;
  font-weight: 700;
  letter-spacing: 0.1em;
}
.week .sun { color: var(--sun); }
.week .sat { color: var(--sat); }

/* ---------- Keys ---------- */
.pad {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2cqi;
}
.slot {
  /* The hole in the plate the key rides in */
  padding: 0.5cqi 0.5cqi calc(var(--t) + 0.5cqi);
  border-radius: 2.8cqi;
  background: var(--well);
  box-shadow: inset 0 0.4cqi 0.8cqi rgba(0, 0, 0, 0.35), 0 0.25cqi 0 rgba(255, 255, 255, 0.28);
}
.fn .slot { padding-bottom: calc(var(--t) + 0.5cqi); }
.key {
  --c-hi: var(--cap-hi);
  --c: var(--cap);
  --c-lo: var(--cap-lo);
  --c-wall: var(--wall);
  appearance: none;
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1 / 0.86;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 2.3cqi;
  font: inherit;
  color: var(--legend);
  cursor: pointer;
  touch-action: manipulation;
  outline: none;
  background:
    radial-gradient(110% 80% at 50% 12%, var(--c-hi), var(--c) 55%, var(--c-lo));
  transform: translateY(0);
  box-shadow:
    0 var(--t) 0 var(--c-wall),
    0 calc(var(--t) + 0.5cqi) 1.1cqi rgba(0, 0, 0, 0.32),
    inset 0 0.3cqi 0 rgba(255, 255, 255, 0.5),
    inset 0 -0.5cqi 0.9cqi rgba(0, 0, 0, 0.07);
  /* Coming back up is a spring: the interlock lets go and the key bounces a hair past its rest before settling */
  transition:
    transform 0.46s cubic-bezier(0.25, 1.75, 0.45, 1),
    box-shadow 0.46s cubic-bezier(0.25, 1.75, 0.45, 1),
    opacity 0.4s ease,
    filter 0.2s ease;
}
.key.latched {
  transform: translateY(calc(var(--t) * 0.8));
  box-shadow:
    0 calc(var(--t) * 0.2) 0 var(--c-wall),
    0 calc(var(--t) * 0.2 + 0.2cqi) 0.5cqi rgba(0, 0, 0, 0.3),
    inset 0 0.3cqi 0 rgba(255, 255, 255, 0.2),
    inset 0 0.9cqi 1.4cqi rgba(0, 0, 0, 0.2);
  /* Down in its hole the cap catches less light */
  filter: brightness(0.93);
  transition:
    transform 0.2s cubic-bezier(0.2, 0.7, 0.3, 1),
    box-shadow 0.2s cubic-bezier(0.2, 0.7, 0.3, 1),
    opacity 0.4s ease,
    filter 0.2s ease;
}
.key.down {
  transform: translateY(var(--t));
  box-shadow:
    0 0 0 var(--c-wall),
    0 0.15cqi 0.35cqi rgba(0, 0, 0, 0.3),
    inset 0 0.3cqi 0 rgba(255, 255, 255, 0.15),
    inset 0 0.8cqi 1.2cqi rgba(0, 0, 0, 0.2);
  transition:
    transform 0.075s cubic-bezier(0.5, 0, 0.9, 0.5),
    box-shadow 0.075s cubic-bezier(0.5, 0, 0.9, 0.5),
    opacity 0.4s ease,
    filter 0.2s ease;
}
/* A blank key: no day under it this month, so it sits flush and dark in its hole */
.key.blank {
  transform: translateY(var(--t));
  box-shadow:
    0 0 0 var(--c-wall),
    0 0 0 rgba(0, 0, 0, 0),
    inset 0 0.3cqi 0 rgba(255, 255, 255, 0),
    inset 0 0.5cqi 0.9cqi rgba(0, 0, 0, 0.12);
  opacity: 0.42;
  cursor: default;
  pointer-events: none;
  transition:
    transform 0.32s cubic-bezier(0.4, 0, 0.6, 1),
    box-shadow 0.32s cubic-bezier(0.4, 0, 0.6, 1),
    opacity 0.32s ease;
}
/* Out of range: the key is locked; it gives only a hair when pressed */
.key.off { cursor: not-allowed; }
.key.off .legend { opacity: 0.32; }
.key.jam { animation: jam 0.24s cubic-bezier(0.3, 0.7, 0.4, 1); }
@keyframes jam {
  35% { transform: translateY(calc(var(--t) * 0.22)); }
}
@media (hover: hover) {
  .key:not(.blank):not(.off):not(.down):not(.latched):hover { filter: brightness(1.035); }
}
.shell:not(.pointer) .key:focus-visible::before {
  content: "";
  position: absolute;
  inset: -0.9cqi;
  border-radius: 3cqi;
  border: 0.45cqi solid var(--amber);
  pointer-events: none;
}

.legend {
  font-size: 4.4cqi;
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 1;
  pointer-events: none;
}
.key.blank .legend, .key.blank .lamp { opacity: 0; }
.key.sun { color: var(--sun); }
.key.sat { color: var(--sat); }
.key.past { color: var(--muted); }
/* Today: a pinhead lamp under the number */
.key .lamp {
  position: absolute;
  bottom: 13%;
  left: 50%;
  width: 1cqi;
  height: 1cqi;
  margin-left: -0.5cqi;
  border-radius: 50%;
  background: #6b3a1a;
  opacity: 0;
  transition: opacity 0.4s ease, background-color 0.4s ease, box-shadow 0.4s ease;
}
.key.today .lamp {
  opacity: 1;
  background: #ffc067;
  box-shadow: 0 0 0.5cqi #ff9a2e, 0 0 1.4cqi rgba(255, 120, 20, 0.6);
}

/* Function keys: dark caps, momentary (they always spring back) */
.key.fnk {
  --c-hi: var(--fn-hi);
  --c: var(--fn);
  --c-lo: var(--fn-lo);
  --c-wall: var(--fn-wall);
  color: var(--fn-legend);
}
.key.hot {
  --c-hi: var(--hot-hi);
  --c: var(--hot);
  --c-lo: var(--hot-lo);
  --c-wall: var(--hot-wall);
  color: #fff6ec;
}
.key.fnk .legend, .key.hot .legend { font-size: 3cqi; font-weight: 700; letter-spacing: 0.04em; }
.key svg { width: 3.4cqi; height: 3.4cqi; pointer-events: none; }
.key[disabled] { cursor: not-allowed; }
.key[disabled] .legend, .key[disabled] svg { opacity: 0.35; }

.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@supports (corner-shape: squircle) {
  .shell, .window, .slot, .key, .solar { corner-shape: squircle; }
  .shell { border-radius: 9cqi; }
  .window { border-radius: 5cqi; }
  .slot { border-radius: 4.4cqi; }
  .key { border-radius: 3.6cqi; }
}
@media (prefers-reduced-motion: reduce) {
  .key, .key.latched, .key.down, .key.blank { transition-duration: 0.12s; transition-timing-function: ease; }
}
`;

const CHEVRON = (dir: 'l' | 'r') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'l' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

const TEMPLATE = `
<style>${STYLE}</style>
<div class="shell" part="shell">
  <div class="mark" aria-hidden="true"><span>CALENDAR NEO <small>RC-8</small></span><span class="solar"><i></i><i></i><i></i><i></i></span></div>
  <div class="window" part="display" role="status" aria-live="polite">
    ${displaySvg()}
    <div class="days" aria-hidden="true"></div>
    <span class="sr readout"></span>
  </div>
  <div class="fn">
    <span class="slot"><button class="key hot clear" type="button"><span class="legend">C</span></button></span>
    <span class="slot"><button class="key fnk prev" type="button">${CHEVRON('l')}</button></span>
    <div class="month" aria-live="polite"><span></span></div>
    <span class="slot"><button class="key fnk next" type="button">${CHEVRON('r')}</button></span>
    <span class="slot"><button class="key fnk today-key" type="button"><span class="legend"></span></button></span>
  </div>
  <div class="week" aria-hidden="true"></div>
  <div class="pad" role="radiogroup"></div>
</div>
`;

interface SlotState {
  key: string | null;
  label: string;
  cls: string[];
}

/** Below this much horizontal wheel travel (a trackpad swipe) the month does not turn. */
const SWIPE = 60;

/**
 * <retro-calendar>: a single-date picker built like an old desk calculator. Every day is a key, and the keys interlock
 * like the station buttons of an old radio: press one and it latches down, and whichever key was down springs back up.
 * The chosen date glows on an orange filament display.
 *
 * Attributes: value="2026-10-14"  month="2026-10"  min="today"  max="+90"  week-start="0|1"  locale="ja-JP"  theme="light|dark"
 * Events: change (detail: { value }), monthchange (detail: { month })
 */
export class RetroCalendar extends HTMLElement {
  static observedAttributes = ['value', 'month', 'min', 'max', 'week-start', 'locale', 'theme'];

  readonly range = new DayRange();

  private $shell: HTMLElement;
  private $pad: HTMLElement;
  private $month: HTMLElement;
  private $week: HTMLElement;
  private $days: HTMLElement;
  private $readout: HTMLElement;
  private $prev: HTMLButtonElement;
  private $next: HTMLButtonElement;
  private $today: HTMLButtonElement;
  private $clear: HTMLButtonElement;
  private keys: HTMLButtonElement[] = [];
  private segs: SVGGElement[][] = [];
  private dots: SVGGElement[] = [];

  private _value: string | null = null;
  private monthIdx: number;
  private weekStart = 0;
  private locale: string | undefined;
  private slots: SlotState[] = [];
  private focusIdx = -1;
  private rendered = false;
  private wheelX = 0;
  private wheelT = 0;
  private wheelSpent = false;
  private press: { el: HTMLButtonElement; id: number; inside: boolean } | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$shell = q('.shell');
    this.$pad = q('.pad');
    this.$month = q('.month');
    this.$week = q('.week');
    this.$days = q('.days');
    this.$readout = q('.readout');
    this.$prev = q('.prev');
    this.$next = q('.next');
    this.$today = q('.today-key');
    this.$clear = q('.clear');

    for (const digit of root.querySelectorAll('.digit')) {
      this.segs.push([...digit.querySelectorAll<SVGGElement>('.seg')]);
    }
    this.dots = [...root.querySelectorAll<SVGGElement>('.seg.dp')];

    for (let i = 0; i < SLOTS; i++) {
      const slot = document.createElement('span');
      slot.className = 'slot';
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'key blank';
      key.setAttribute('role', 'radio');
      key.tabIndex = -1;
      key.dataset.i = String(i);
      key.innerHTML = '<span class="legend"></span><span class="lamp"></span>';
      slot.append(key);
      this.$pad.append(slot);
      this.keys.push(key);
    }

    const now = new Date();
    this.monthIdx = now.getFullYear() * 12 + now.getMonth();

    this.$pad.addEventListener('pointerdown', (e) => this.onDown(e));
    root.querySelector('.fn')!.addEventListener('pointerdown', (e) => this.onDown(e as PointerEvent));
    this.$shell.addEventListener('keydown', () => this.$shell.classList.remove('pointer'));
    this.$pad.addEventListener('keydown', (e) => this.onKey(e));
    this.$pad.addEventListener('keyup', (e) => this.onKeyUp(e));
    for (const b of [this.$prev, this.$next, this.$today, this.$clear]) {
      // Keyboard and assistive tech reach these as plain buttons; pointer presses come through onDown/onUp
      b.addEventListener('click', (e) => {
        if ((e as PointerEvent).detail === 0) this.fn(b);
      });
    }
    this.$pad.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  connectedCallback(): void {
    if (!this.rendered) this.render(0);
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    switch (name) {
      case 'value':
        this.value = v;
        break;
      case 'month':
        if (v && /^\d{4}-\d{1,2}$/.test(v)) this.show(v);
        break;
      case 'min':
      case 'max':
        this.range.set(name, v);
        this.applyRange();
        break;
      case 'week-start':
        this.weekStart = v === null ? 0 : ((Number(v) % 7) + 7) % 7 || 0;
        if (this.rendered) this.render(0);
        break;
      case 'locale':
        this.locale = v ?? undefined;
        if (this.rendered) this.render(0);
        break;
    }
  }

  // ---------- Public API ----------

  /** The chosen date (YYYY-MM-DD), or null. Only ever one. */
  get value(): string | null {
    return this._value;
  }

  set value(v: string | null) {
    const key = v && /^\d{4}-\d{2}-\d{2}$/.test(v) && this.range.allows(v) ? v : null;
    if (key === this._value) return;
    this._value = key;
    if (key && monthIndexOf(key) !== this.monthIdx && !(this.hasAttribute('month') && !this.rendered)) this.goto(monthIndexOf(key));
    this.sync();
  }

  get min(): string | null {
    return this.range.min;
  }

  set min(v: string | null) {
    if (v === null) this.removeAttribute('min');
    else this.setAttribute('min', v);
  }

  get max(): string | null {
    return this.range.max;
  }

  set max(v: string | null) {
    if (v === null) this.removeAttribute('max');
    else this.setAttribute('max', v);
  }

  /** The month on the keys, YYYY-MM. */
  get month(): string {
    return `${Math.floor(this.monthIdx / 12)}-${String((this.monthIdx % 12) + 1).padStart(2, '0')}`;
  }

  next(): void {
    this.goto(this.monthIdx + 1);
  }

  prev(): void {
    this.goto(this.monthIdx - 1);
  }

  /** Show a month (YYYY-MM or YYYY-MM-DD). */
  show(month: string): void {
    const m = /^(\d{4})-(\d{1,2})/.exec(month);
    if (m) this.goto(Number(m[1]) * 12 + Number(m[2]) - 1);
  }

  /** Release the key that is down. */
  clear(): void {
    this.choose(null);
  }

  // ---------- Selection ----------

  /** A key was pressed home: it latches, and the interlock throws out whichever key was down before. */
  private choose(key: string | null, popDelay = 0): void {
    if (key === this._value) return;
    this._value = key;
    this.sync(popDelay);
    if (key && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(6);
    this.dispatchEvent(new CustomEvent('change', { detail: { value: key }, bubbles: true, composed: true }));
  }

  private applyRange(): void {
    this.range.refresh();
    const clamped = this.clampMonth(this.monthIdx);
    if (this._value && !this.range.allows(this._value)) this.choose(null);
    if (!this.rendered) {
      this.monthIdx = clamped;
      return;
    }
    if (clamped !== this.monthIdx) this.goto(clamped);
    else this.render(0);
  }

  private clampMonth(k: number): number {
    return Math.min(this.range.maxMonth, Math.max(this.range.minMonth, k));
  }

  private goto(k: number): void {
    k = this.clampMonth(k);
    if (!this.rendered) {
      this.monthIdx = k;
      return;
    }
    if (k === this.monthIdx) return;
    const dir = Math.sign(k - this.monthIdx);
    this.monthIdx = k;
    this.render(this.rendered ? dir : 0);
    this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  // ---------- Drawing ----------

  private words() {
    const lang = (this.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase();
    return WORDS[lang.slice(0, 2)] ?? WORDS.en;
  }

  /** Lay the month out on the keys. dir is -1 / 1 when turning to an earlier / later month, 0 for no animation. */
  private render(dir: number): void {
    this.range.refresh();
    const y = Math.floor(this.monthIdx / 12);
    const m0 = this.monthIdx % 12;
    const now = new Date();
    const today = keyOf(now.getFullYear(), now.getMonth(), now.getDate());
    const w = this.words();

    // Faceplate print: the month, the weekday heads, the function keys
    const title = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' }).format(new Date(y, m0, 1));
    this.roll(this.$month, title, dir);
    const wd = new Intl.DateTimeFormat(this.locale, { weekday: 'short' });
    const short = new Intl.DateTimeFormat(this.locale, { weekday: 'narrow' });
    const heads: string[] = [];
    const lamps: string[] = [];
    for (let i = 0; i < 7; i++) {
      const n = (this.weekStart + i) % 7;
      // 2023-01-01 was a Sunday
      const d = new Date(2023, 0, 1 + n);
      const cls = n === 0 ? 'sun' : n === 6 ? 'sat' : '';
      heads.push(`<span class="${cls}">${short.format(d)}</span>`);
      lamps.push(`<span data-wd="${n}">${wd.format(d).replace(/\.$/, '')}</span>`);
    }
    this.$week.innerHTML = heads.join('');
    if (this.$days.dataset.sig !== lamps.join()) {
      this.$days.innerHTML = lamps.join('');
      this.$days.dataset.sig = lamps.join();
    }
    this.$today.querySelector('.legend')!.textContent = w.today;
    this.$prev.setAttribute('aria-label', w.prev);
    this.$next.setAttribute('aria-label', w.next);
    this.$clear.setAttribute('aria-label', w.clear);
    this.$prev.disabled = this.monthIdx <= this.range.minMonth;
    this.$next.disabled = this.monthIdx >= this.range.maxMonth;
    this.$pad.setAttribute('aria-label', title);

    const label = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const days = monthSlots(y, m0, this.weekStart);
    const prev = this.slots;
    this.slots = days.map((d, i) => {
      if (d === null) return { key: null, label: '', cls: ['blank'] };
      const key = keyOf(y, m0, d);
      const wdN = (this.weekStart + i) % 7;
      const cls: string[] = [];
      if (wdN === 0) cls.push('sun');
      if (wdN === 6) cls.push('sat');
      if (key < today) cls.push('past');
      if (key === today) cls.push('today');
      if (!this.range.allows(key)) cls.push('off');
      return { key, label: String(d), cls };
    });

    this.slots.forEach((s, i) => {
      const el = this.keys[i];
      const legend = el.firstElementChild as HTMLElement;
      el.dataset.key = s.key ?? '';
      el.setAttribute('aria-label', s.key ? label.format(new Date(y, m0, Number(s.label))) : '');
      el.setAttribute('aria-disabled', String(!s.key || s.cls.includes('off')));
      const was = prev[i];
      const paint = () => {
        legend.textContent = s.label;
        for (const c of ['sun', 'sat', 'past', 'today', 'off']) el.classList.toggle(c, s.cls.includes(c));
      };
      // Blank keys sink flush, new ones rise out of the plate; keys that stay up roll their legends like a drum
      el.classList.toggle('blank', !s.key);
      for (const a of legend.getAnimations()) a.cancel();
      if (!dir || !was || !was.key || !s.key || was.label === s.label) {
        if (s.key || !dir) paint();
        else setTimeout(() => this.slots[i] === s && paint(), 320);
        return;
      }
      const delay = (dir > 0 ? i : SLOTS - 1 - i) * 5;
      const out = legend.animate(
        [
          { transform: 'translateY(0)', opacity: 1 },
          { transform: `translateY(${-dir * 55}%)`, opacity: 0 },
        ],
        { duration: 130, delay, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' },
      );
      out.onfinish = () => {
        paint();
        legend.animate(
          [
            { transform: `translateY(${dir * 55}%)`, opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
        );
        out.cancel();
      };
    });
    this.rendered = true;
    this.sync();
  }

  /** Swap a printed label with a short vertical roll in the direction of travel. */
  private roll(box: HTMLElement, text: string, dir: number): void {
    const cur = box.lastElementChild as HTMLElement;
    if (cur.textContent === text) return;
    if (!dir || !cur.textContent) {
      cur.textContent = text;
      return;
    }
    const next = document.createElement('span');
    next.textContent = text;
    box.append(next);
    const ease = 'cubic-bezier(0.25, 0.8, 0.3, 1)';
    for (const old of [...box.children].slice(0, -1) as HTMLElement[]) {
      old.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: `translateY(${-dir * 60}%)` }], {
        duration: 260,
        easing: ease,
        fill: 'forwards',
      }).onfinish = () => old.remove();
    }
    next.animate([{ opacity: 0, transform: `translateY(${dir * 60}%)` }, { opacity: 1, transform: 'translateY(0)' }], {
      duration: 320,
      easing: ease,
    });
  }

  /** Bring the keys and the display in line with the value. */
  private sync(popDelay = 0): void {
    if (!this.rendered) return;
    const v = this._value;
    let latchedIdx = -1;
    this.keys.forEach((el, i) => {
      const on = !!v && this.slots[i]?.key === v;
      if (on) latchedIdx = i;
      el.setAttribute('aria-checked', String(on));
      if (el === this.press?.el) return;
      if (on) el.classList.add('latched');
      else if (el.classList.contains('latched')) {
        // When thrown out by another key, the interlock bar trips a beat after the new key passes the catch
        if (popDelay) setTimeout(() => el.getAttribute('aria-checked') === 'false' && el.classList.remove('latched'), popDelay);
        else el.classList.remove('latched');
      }
    });
    if (this.focusIdx < 0 || !this.slots[this.focusIdx]?.key) {
      const today = this.keys.findIndex((k) => k.classList.contains('today'));
      this.focusIdx = latchedIdx >= 0 ? latchedIdx : today >= 0 ? today : this.slots.findIndex((s) => s.key);
    }
    if (latchedIdx >= 0) this.focusIdx = latchedIdx;
    this.keys.forEach((el, i) => (el.tabIndex = i === this.focusIdx ? 0 : -1));

    // The filament display
    const chars = displayChars(v);
    chars.forEach((ch, i) => {
      const lit = DIGITS[ch] ?? '';
      for (const g of this.segs[i]) {
        const name = g.getAttribute('class')!.match(/s-([a-g])/)![1];
        g.classList.toggle('on', !!v && lit.includes(name));
        g.classList.toggle('dim', !v && lit.includes(name));
      }
    });
    for (const d of this.dots) {
      d.classList.toggle('on', !!v);
      d.classList.toggle('dim', !v);
    }
    const wdN = v ? new Date(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10))).getDay() : -1;
    for (const s of this.$days.children) s.classList.toggle('on', Number((s as HTMLElement).dataset.wd) === wdN);
    this.$readout.textContent = v
      ? new Intl.DateTimeFormat(this.locale, { dateStyle: 'full' }).format(
          new Date(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10))),
        )
      : this.words().none;
  }

  // ---------- Input ----------

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || this.press) return;
    const el = (e.target as Element).closest<HTMLButtonElement>('.key');
    if (!el || el.classList.contains('blank')) return;
    e.preventDefault();
    if (el.disabled || el.classList.contains('off')) {
      this.jam(el);
      return;
    }
    // Focus follows the finger, but the keyboard ring stays away until a key on the keyboard is used
    this.$shell.classList.add('pointer');
    el.focus({ preventScroll: true });
    if (el.dataset.i) this.focusIdx = Number(el.dataset.i);
    this.press = { el, id: e.pointerId, inside: true };
    el.classList.add('down');
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== this.press?.id) return;
      const r = el.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8;
      if (inside !== this.press.inside) {
        this.press.inside = inside;
        el.classList.toggle('down', inside);
      }
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== this.press?.id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      const commit = ev.type === 'pointerup' && this.press.inside;
      this.press = null;
      el.classList.remove('down');
      if (commit) this.release(el);
      else this.sync();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** A key comes up off the bottom: a day key latches (and throws out the old one), a function key does its job. */
  private release(el: HTMLButtonElement): void {
    if (el.dataset.i !== undefined) {
      const key = el.dataset.key || null;
      if (key) el.classList.add('latched');
      this.choose(key, 45);
    } else {
      this.fn(el);
    }
  }

  private fn(el: HTMLButtonElement): void {
    if (el === this.$prev) this.prev();
    else if (el === this.$next) this.next();
    else if (el === this.$clear) this.clear();
    else if (el === this.$today) {
      const now = new Date();
      this.goto(now.getFullYear() * 12 + now.getMonth());
    }
  }

  private jam(el: HTMLElement): void {
    el.classList.remove('jam');
    void el.offsetWidth;
    el.classList.add('jam');
    el.addEventListener('animationend', () => el.classList.remove('jam'), { once: true });
  }

  /** Arrow keys walk the keys (across into the next or previous month at the edges); Enter / Space press one. */
  private onKey(e: KeyboardEvent): void {
    const el = (e.target as Element).closest<HTMLButtonElement>('.key');
    if (!el || el.dataset.i === undefined) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.repeat) return;
      if (el.classList.contains('off')) return this.jam(el);
      el.classList.add('down');
      if (e.key === 'Enter') setTimeout(() => this.keyUp(el), 110);
      return;
    }
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      this.goto(this.monthIdx + (e.key === 'PageUp' ? -1 : 1));
      this.focusKey(this.focusIdx);
      return;
    }
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    const from = this.slots[Number(el.dataset.i)].key!;
    const d = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)) + step);
    const target = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
    const k = d.getFullYear() * 12 + d.getMonth();
    if (k !== this.monthIdx) {
      if (this.clampMonth(k) !== k) return;
      this.goto(k);
    }
    this.focusKey(this.slots.findIndex((s) => s.key === target));
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key !== ' ') return;
    const el = (e.target as Element).closest<HTMLButtonElement>('.key');
    if (el?.classList.contains('down')) this.keyUp(el);
  }

  private keyUp(el: HTMLButtonElement): void {
    el.classList.remove('down');
    this.release(el);
  }

  private focusKey(i: number): void {
    if (i < 0 || !this.slots[i]?.key) i = this.slots.findIndex((s) => s.key);
    this.focusIdx = i;
    this.keys.forEach((el, j) => (el.tabIndex = j === i ? 0 : -1));
    this.keys[i]?.focus({ preventScroll: true });
  }

  /** Two-finger sideways swipe on a trackpad turns the month. */
  private onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const t = performance.now();
    if (t - this.wheelT > 300) {
      this.wheelX = 0;
      this.wheelSpent = false;
    }
    this.wheelT = t;
    // One month per swipe: the rest of the gesture's momentum is swallowed
    if (this.wheelSpent) return;
    this.wheelX += e.deltaX;
    if (Math.abs(this.wheelX) >= SWIPE) {
      this.wheelSpent = true;
      this.goto(this.monthIdx + Math.sign(this.wheelX));
    }
  }
}
