import { DayRange, monthIndexOf } from './range';
import { SLOTS, keyOf, monthKeys, monthSlots } from './keypad';
import { roundedRect } from './g2';

/* ---------- Words on the faceplate, in the reader's language ---------- */

interface Words {
  today: string;
  prev: string;
  next: string;
  prevYear: string;
  nextYear: string;
  months: string;
  days: string;
  none: string;
}

const WORDS: Record<string, Words> = {
  en: {
    today: 'Today',
    prev: 'Previous month',
    next: 'Next month',
    prevYear: 'Previous year',
    nextYear: 'Next year',
    months: 'choose month and year',
    days: 'back to the days',
    none: 'No date chosen',
  },
  ja: {
    today: '今日',
    prev: '前の月',
    next: '次の月',
    prevYear: '前の年',
    nextYear: '次の年',
    months: '年と月を選ぶ',
    days: '日付に戻る',
    none: '日付が選ばれていません',
  },
  zh: {
    today: '今天',
    prev: '上个月',
    next: '下个月',
    prevYear: '上一年',
    nextYear: '下一年',
    months: '选择年月',
    days: '回到日期',
    none: '尚未选择日期',
  },
};

const MINCHO = `"Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Noto Serif JP", "Songti SC", serif`;

const STYLE = /* css */ `
:host {
  --rc-width: 22rem;
  display: inline-block;
  width: var(--rc-width);
  max-width: 100%;
  /* Everything is measured off the calculator's own width */
  container-type: inline-size;
  -webkit-tap-highlight-color: transparent;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "PingFang SC", "Microsoft YaHei", sans-serif;

  /* The house colours of a travel site in Japan: a warm sunflower yellow for what is chosen, near-black ink, and clear
     glass for everything else */
  --sunflower: #ffc915;
  --sunflower-deep: #f2ae00;
  --ink: #1d1f23;

  --legend: #24262b;
  --print: rgba(36, 38, 43, 0.6);
  --sun: #d23a2a;
  --sat: #2a5fae;
  --muted: rgba(36, 38, 43, 0.38);
  /* Glass: the body, the keys, and the slab edge a key shows when it stands up */
  --body-tint: linear-gradient(160deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.16) 55%, rgba(255, 255, 255, 0.26));
  --key-tint: linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.42));
  --key-edge: rgba(70, 60, 50, 0.16);
  --groove: rgba(40, 30, 20, 0.07);
  --smoke-tint: linear-gradient(180deg, rgba(48, 48, 54, 0.72), rgba(28, 28, 32, 0.6));
  --drop: rgba(40, 25, 10, 0.28);
  --drop-wide: rgba(40, 25, 10, 0.16);
  /* A hairline round the body, so clear glass still has an edge on a white page */
  --outline: rgba(60, 40, 20, 0.12);
  --title-hover: rgba(255, 255, 255, 0.3);
  /* The window of a weekday lamp, smoked like the arrow keys */
  --lamp-window: rgba(30, 28, 26, 0.8);
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --legend: #f1efe9;
    --print: rgba(241, 239, 233, 0.6);
    --sun: #ff8070;
    --sat: #86b4ff;
    --muted: rgba(241, 239, 233, 0.34);
    --body-tint: linear-gradient(160deg, rgba(60, 60, 70, 0.34), rgba(20, 20, 26, 0.26) 55%, rgba(40, 40, 48, 0.3));
    --key-tint: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.1));
    --key-edge: rgba(0, 0, 0, 0.4);
    --groove: rgba(0, 0, 0, 0.22);
    --smoke-tint: linear-gradient(180deg, rgba(10, 10, 12, 0.6), rgba(0, 0, 0, 0.5));
    --drop: rgba(0, 0, 0, 0.5);
    --drop-wide: rgba(0, 0, 0, 0.36);
    --outline: rgba(255, 255, 255, 0.1);
    --title-hover: rgba(255, 255, 255, 0.08);
    --lamp-window: rgba(0, 0, 0, 0.55);
  }
}
:host([theme="dark"]) {
  --legend: #f1efe9;
  --print: rgba(241, 239, 233, 0.6);
  --sun: #ff8070;
  --sat: #86b4ff;
  --muted: rgba(241, 239, 233, 0.34);
  --body-tint: linear-gradient(160deg, rgba(60, 60, 70, 0.34), rgba(20, 20, 26, 0.26) 55%, rgba(40, 40, 48, 0.3));
  --key-tint: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.1));
  --key-edge: rgba(0, 0, 0, 0.4);
  --groove: rgba(0, 0, 0, 0.22);
  --smoke-tint: linear-gradient(180deg, rgba(10, 10, 12, 0.6), rgba(0, 0, 0, 0.5));
  --drop: rgba(0, 0, 0, 0.5);
  --drop-wide: rgba(0, 0, 0, 0.36);
  --outline: rgba(255, 255, 255, 0.1);
  --title-hover: rgba(255, 255, 255, 0.08);
  --lamp-window: rgba(0, 0, 0, 0.55);
}

/*
 * Golden proportions, all from the gap between two keys (g):
 *   the margin round the keys is φ²·g, and the slot a key rides in has a lip of g/φ³ (a quarter of g, near enough);
 *   a key is φ/2 as tall as it is wide; its corner is 1/φ³ of its height, its travel 1/φ⁴, its number 1/φ² of its width;
 *   every corner further out is the one inside it plus the distance between them, so all of them share a centre.
 */
.shell {
  --g: 2cqi;
  --pad: calc(var(--g) * 2.618);
  --lip: calc(var(--g) * 0.236);
  --kw: calc((100cqi - 2 * var(--pad) - 6 * var(--g)) / 7 - 2 * var(--lip));
  --kh: calc(var(--kw) * 0.809);
  --r: calc(var(--kh) * 0.236);
  --t: calc(var(--kh) * 0.146);
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  padding: var(--pad);
  border-radius: calc(var(--r) + var(--lip) + var(--pad));
  /* Only the shadow belongs to the shell itself: the glass is a layer of its own under the keys, so that each key's own
     glass sees (and bends) the body's glass and whatever is behind the calculator */
  box-shadow:
    0 0 0 0.5px var(--outline),
    0 0.6cqi 1.4cqi -0.4cqi var(--drop),
    0 5cqi 9cqi -3cqi var(--drop),
    0 4cqi 16cqi -2cqi var(--drop-wide);
}
.glass {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  clip-path: var(--g2-body, none);
  background: var(--body-tint);
  -webkit-backdrop-filter: blur(14px) saturate(1.7);
  backdrop-filter: blur(14px) saturate(1.7);
  box-shadow: inset 0 0 2.4cqi rgba(255, 255, 255, 0.16);
}
.glass.bend { backdrop-filter: blur(14px) saturate(1.7) url(#lens-body); }
/* Light along the rim of a piece of glass: bright where it faces the light, top left, and again faintly across the way */
.glass::after, .face::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--rim) no-repeat 0 0 / 100% 100%;
}
.glass::after { --rim: var(--rim-body, none); }
.shell > :not(.glass) { position: relative; }

/* ---------- The top row: the arrows either side of the month, Today at the end ---------- */
.fn {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
  align-items: center;
  margin: 0 0 calc(var(--g) * 0.618);
}
/* The month, set in Mincho; it is also a button that turns the days into the twelve months */
.title {
  grid-column: span 4;
  position: relative;
  height: calc(var(--kh) + 2 * var(--lip) + var(--t));
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: calc(var(--r) + var(--lip));
  appearance: none;
  background: transparent;
  color: var(--legend);
  font: inherit;
  cursor: pointer;
  outline: none;
  transition: background-color 0.25s ease;
}
@media (hover: hover) {
  .title:hover { background-color: var(--title-hover); }
}
.roll {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  transition: opacity 0.3s ease var(--plate, 0s), transform 0.12s ease;
}
.title:active .roll { transform: translateY(0.25cqi); }
.roll > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.9cqi;
  white-space: nowrap;
  font-family: ${MINCHO};
  font-size: 3.9cqi;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.caret { flex: none; width: 2.5cqi; height: 2.5cqi; opacity: 0.5; }
.caret.up { transform: rotate(180deg); }

/* ---------- The days of the week, each a lamp that lights over the chosen day's column ---------- */
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
  margin: calc(var(--g) * 1.618) 0 calc(var(--g) * 0.618);
  color: var(--print);
  font-family: ${MINCHO};
  font-size: 3.1cqi;
  font-weight: 600;
  line-height: 1;
  transition: opacity 0.3s ease var(--plate, 0s);
}
/* Unlit, just the print, Sunday red and Saturday blue as a Japanese calendar has them. Lit, a small smoked window
   with the letter glowing in it like a filament: it heats fast and cools slowly, so moving to another column the old
   lamp glows down rather than blinking out */
.week span {
  justify-self: center;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-width: calc(var(--kw) * 0.618);
  height: calc(var(--g) * 2.618);
  padding: 0 0.8cqi;
  border-radius: 999px;
  background-color: transparent;
  transition:
    color 0.55s cubic-bezier(0.2, 0.6, 0.3, 1),
    background-color 0.55s cubic-bezier(0.2, 0.6, 0.3, 1),
    box-shadow 0.55s cubic-bezier(0.2, 0.6, 0.3, 1),
    text-shadow 0.55s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.week .sun { color: var(--sun); }
.week .sat { color: var(--sat); }
.week span.lit {
  color: #ffe9a0;
  background-color: var(--lamp-window);
  text-shadow: 0 0 0.45cqi #ffc915, 0 0 1.3cqi rgba(255, 190, 13, 0.8);
  box-shadow: inset 0 0.25cqi 0.6cqi rgba(0, 0, 0, 0.55), 0 0 1.4cqi rgba(255, 190, 13, 0.35);
  transition-duration: 0.16s;
}

/* ---------- The pads: the days, and in their place on demand the twelve months ---------- */
.board { position: relative; }
.pad {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
}
.months {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: var(--g);
}
.away .week { opacity: 0; }
.slot {
  /* The groove in the glass the key rides in */
  padding: var(--lip) var(--lip) calc(var(--t) + var(--lip));
  border-radius: calc(var(--r) + var(--lip));
  background-color: var(--groove);
  box-shadow: inset 0 0.3cqi 0.7cqi rgba(0, 0, 0, 0.14), 0 0.15cqi 0 rgba(255, 255, 255, 0.3);
  transition: background-color 0.3s ease var(--plate, 0s), box-shadow 0.3s ease var(--plate, 0s);
}
/* A pad put away, or the whole calculator folded: smooth glass, no grooves */
.away .slot, .folded .slot { background-color: transparent; box-shadow: none; }
.folded .roll, .folded .week { opacity: 0; }

/* ---------- Keys ---------- */
.key {
  --tint: var(--key-tint);
  --edge: var(--key-edge);
  appearance: none;
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1 / 0.809;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--r);
  background: none;
  font: inherit;
  color: var(--legend);
  cursor: pointer;
  touch-action: manipulation;
  outline: none;
  transform: translateY(0);
  /* Coming back up is a spring: the interlock lets go and the key bounces a hair past its rest before settling */
  transition: transform 0.46s cubic-bezier(0.25, 1.75, 0.45, 1);
}
.months .key { height: 100%; aspect-ratio: auto; }
/* The key is a slab of glass: what shows below it is its edge, and under that its shadow */
.key::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    0 var(--t) 0 var(--edge),
    0 calc(var(--t) + 0.4cqi) 1.1cqi rgba(0, 0, 0, 0.18);
  transition: box-shadow 0.46s cubic-bezier(0.25, 1.75, 0.45, 1);
}
/* Its face: frosted glass, blurring what is under it and, near its rim, bending it */
.face {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  clip-path: var(--g2-key, none);
  background: var(--tint);
  -webkit-backdrop-filter: blur(6px) saturate(1.15);
  backdrop-filter: blur(6px) saturate(1.15);
  box-shadow: inset 0 -0.5cqi 1cqi rgba(255, 255, 255, 0.14), inset 0 0.5cqi 1cqi rgba(255, 255, 255, 0.18);
  transition: background 0.3s ease, opacity 0.32s ease;
}
.face::after { --rim: var(--rim-key, none); transition: opacity 0.3s ease; }
.bend .face { backdrop-filter: blur(6px) saturate(1.15) url(#lens-key); }
.mkey .face { clip-path: var(--g2-mkey, none); }
.mkey .face::after { --rim: var(--rim-mkey, none); }
.bend-m .mkey .face { backdrop-filter: blur(6px) saturate(1.15) url(#lens-mkey); }
.key.latched {
  --tint: linear-gradient(180deg, rgba(255, 214, 60, 0.92), rgba(255, 196, 10, 0.8));
  --edge: rgba(190, 130, 0, 0.45);
  color: var(--ink);
  transform: translateY(calc(var(--t) * 0.8));
  transition: transform 0.2s cubic-bezier(0.2, 0.7, 0.3, 1);
}
.key.latched::before {
  box-shadow:
    0 calc(var(--t) * 0.2) 0 var(--edge),
    0 calc(var(--t) * 0.2 + 0.2cqi) 0.9cqi rgba(255, 170, 0, 0.35);
  transition: box-shadow 0.2s cubic-bezier(0.2, 0.7, 0.3, 1);
}
.key.down { transform: translateY(var(--t)); transition: transform 0.075s cubic-bezier(0.5, 0, 0.9, 0.5); }
.key.down::before {
  box-shadow:
    0 0 0 var(--edge),
    0 0.15cqi 0.35cqi rgba(0, 0, 0, 0.2);
  transition: box-shadow 0.075s cubic-bezier(0.5, 0, 0.9, 0.5);
}
.key.down .face::after, .key.latched .face::after { opacity: 0.55; }
/* A blank key: no day under it this month, so it sits flush in its groove, barely there */
.key.blank {
  transform: translateY(var(--t));
  cursor: default;
  pointer-events: none;
  transition: transform 0.32s cubic-bezier(0.4, 0, 0.6, 1);
}
.key.blank::before {
  box-shadow:
    0 0 0 var(--edge),
    0 0 0 rgba(0, 0, 0, 0);
  transition: box-shadow 0.32s cubic-bezier(0.4, 0, 0.6, 1);
}
.key.blank .face { opacity: 0.28; }
/* Out of range: the key is locked; it gives only a hair when pressed */
.key.off { cursor: not-allowed; }
.key.off .legend { opacity: 0.32; }
.key.jam { animation: jam 0.24s cubic-bezier(0.3, 0.7, 0.4, 1); }
@keyframes jam {
  35% { transform: translateY(calc(var(--t) * 0.22)); }
}
@media (hover: hover) {
  .key:not(.blank):not(.off):not(.down):not(.latched):hover .face::after { opacity: 1.0; }
  .key:not(.blank):not(.off):not(.down):not(.latched):hover { --tint: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.4)); }
  .key.fnk:not(.down):hover { --tint: linear-gradient(180deg, rgba(62, 62, 70, 0.74), rgba(36, 36, 42, 0.62)); }
}
.shell:not(.pointer) .key:focus-visible::after, .shell:not(.pointer) .title:focus-visible::after {
  content: "";
  position: absolute;
  inset: calc(var(--lip) * -2.618);
  border-radius: calc(var(--r) + var(--lip) * 2.618);
  border: 0.45cqi solid var(--sunflower-deep);
  pointer-events: none;
}
.shell:not(.pointer) .title:focus-visible::after { inset: 0; border-radius: inherit; }

.legend {
  position: relative;
  font-size: calc(var(--kw) * 0.382);
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 1;
  pointer-events: none;
  transition: color 0.3s ease, opacity 0.26s ease;
}
.mkey .legend { font-size: 3.6cqi; letter-spacing: 0.02em; }
.key.blank .legend, .key.blank .lamp { opacity: 0; }
.key.sun { color: var(--sun); }
.key.sat { color: var(--sat); }
.key.past { color: var(--muted); }
.key.latched.sun, .key.latched.sat, .key.latched.past { color: var(--ink); }
/* Today (and this month): a pinhead lamp under the number, lit the same yellow as the weekday lamps */
.key .lamp {
  position: absolute;
  bottom: 13%;
  left: 50%;
  width: 1cqi;
  height: 1cqi;
  margin-left: -0.5cqi;
  border-radius: 50%;
  background: #8a6a12;
  opacity: 0;
  transition: opacity 0.4s ease, background-color 0.4s ease, box-shadow 0.4s ease;
}
.key.today .lamp {
  opacity: 1;
  background: #ffd43a;
  box-shadow: 0 0 0.5cqi #ffbe0d, 0 0 1.4cqi rgba(255, 190, 13, 0.7);
}
.key.today.latched .lamp { background: #fff6d6; box-shadow: 0 0 0.5cqi #fff; }

/* Function keys, momentary (they always spring back): smoked glass for the arrows, the sunflower yellow for Today */
.key.fnk { --tint: var(--smoke-tint); --edge: rgba(0, 0, 0, 0.3); color: #f6f3ec; }
.key.go { --tint: linear-gradient(180deg, rgba(255, 214, 60, 0.95), rgba(255, 196, 10, 0.86)); --edge: rgba(190, 130, 0, 0.5); color: var(--ink); }
.key.fnk .legend, .key.go .legend { font-size: 3cqi; font-weight: 700; letter-spacing: 0.04em; }
.key.go .legend.long { font-size: 2.4cqi; letter-spacing: 0; }
.key svg { position: relative; width: 3.4cqi; height: 3.4cqi; pointer-events: none; transition: opacity 0.26s ease; }
.key[disabled] { cursor: not-allowed; }
.key[disabled] .legend, .key[disabled] svg { opacity: 0.35; }

/* Stowed: sunk flush into the body with the print gone, as when the calculator is put away or the other pad is up.
   Keys come back up one row after another, each row a beat after the one above it (--rise) */
.key.stow {
  transform: translateY(var(--t));
  pointer-events: none;
  transition: transform 0.24s cubic-bezier(0.4, 0, 0.6, 1);
}
.key.stow::before {
  box-shadow:
    0 0 0 var(--edge),
    0 0 0 rgba(0, 0, 0, 0);
  transition: box-shadow 0.24s cubic-bezier(0.4, 0, 0.6, 1);
}
.key.stow .face, .key.stow .legend, .key.stow svg, .key.stow .lamp { opacity: 0; }
.key, .key::before, .key .face, .key .legend, .key svg, .key .lamp { transition-delay: var(--rise, 0s) !important; }

.lenses { position: absolute; width: 0; height: 0; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Until the exact continuous corners are drawn (and where they are not), the browser's own, where it has them */
@supports (corner-shape: squircle) {
  .shell, .glass, .slot, .key, .face, .title { corner-shape: squircle; }
  .shell { border-radius: calc((var(--r) + var(--lip) + var(--pad)) * 1.3); }
  .slot, .title { border-radius: calc((var(--r) + var(--lip)) * 1.3); }
  .key { border-radius: calc(var(--r) * 1.3); }
}
@media (prefers-reduced-motion: reduce) {
  .key, .key.latched, .key.down, .key.blank, .key.stow, .key::before { transition-duration: 0.12s; transition-timing-function: ease; }
}
/* Laid out at once, with nothing animated */
.shell.still, .shell.still *, .shell.still *::before, .shell.still *::after { transition: none !important; }
`;

const CHEVRON = (dir: 'l' | 'r') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'l' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

const CARET = `<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

/* ---------- Liquid glass ---------- */

/** Bending what is seen through glass needs an SVG filter in backdrop-filter, which only Chromium draws; elsewhere it only blurs. */
const CAN_BEND = typeof navigator !== 'undefined' && 'userAgentData' in navigator;

/** One filter that bends the view through a piece of glass, its map drawn once the glass has been measured. */
const lensFilter = (id: string) =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="0" height="0" color-interpolation-filters="sRGB"><feImage result="map" preserveAspectRatio="none" x="0" y="0" width="0" height="0"/><feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>`;

/**
 * The map for bending the view through a slab of glass whose edge is rounded off over `bezel` px, like a drop of water:
 * flat in the middle, so nothing moves there, and curving down ever more steeply towards its rim, where light coming
 * through is bent inwards, so the view near the edge is drawn from further in and the world behind seems to swell
 * towards the edge. The slope is that of the shape blurred over the bezel, so it follows the continuous corners exactly.
 */
function lensMap(w: number, h: number, edge: string, bezel: number): string | null {
  const W = Math.ceil(w);
  const H = Math.ceil(h);
  if (!W || !H) return null;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.filter = `blur(${bezel / 2}px)`;
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(edge));
  const src = ctx.getImageData(0, 0, W, H).data;
  const at = (x: number, y: number) => src[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + 3] / 255;
  const out = ctx.createImageData(W, H);
  const d = out.data;
  // (the steepest the blurred edge gets, for scaling the slopes to the map's range)
  const steep = 1 / (bezel * 0.8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) / 2;
      const gy = (at(x, y + 1) - at(x, y - 1)) / 2;
      const k = (y * W + x) * 4;
      // (the slope points inwards, and so does the bend)
      d[k] = 128 + Math.max(-127, Math.min(127, (gx / steep) * 127));
      d[k + 1] = 128 + Math.max(-127, Math.min(127, (gy / steep) * 127));
      d[k + 2] = 128;
      d[k + 3] = 255;
    }
  }
  ctx.filter = 'none';
  ctx.putImageData(out, 0, 0);
  return c.toDataURL();
}

const svgUrl = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}")`;

/**
 * The rim of a piece of glass, along its exact continuous edge: a hairline of light, brightest where the edge faces the
 * light (top left), fading round the sides, and catching again faintly across the way.
 */
const rim = (w: number, h: number, edge: string, strength = 1) =>
  svgUrl(
    w,
    h,
    `<defs><linearGradient id="l" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="${h}">` +
      `<stop offset="0" stop-color="#fff" stop-opacity="${0.95 * strength}"/><stop offset=".32" stop-color="#fff" stop-opacity="${0.22 * strength}"/>` +
      `<stop offset=".68" stop-color="#fff" stop-opacity="${0.06 * strength}"/><stop offset="1" stop-color="#fff" stop-opacity="${0.5 * strength}"/></linearGradient></defs>` +
      `<path d="${edge}" fill="none" stroke="url(#l)" stroke-width="2.2"/>`,
  );

/** How far in from its edge the glass is curved (and bends what is seen through it), and how far that bends it at most, as fractions of the key height. */
const KEY_BEZEL = 0.236;
const KEY_SHIFT = 0.236;
/** The same for the body, as fractions of its margin round the keys. */
const BODY_BEZEL = 1;
const BODY_SHIFT = 1;

const TEMPLATE = `
<style>${STYLE}</style>
<svg class="lenses" aria-hidden="true">${lensFilter('lens-body')}${lensFilter('lens-key')}${lensFilter('lens-mkey')}</svg>
<div class="shell" part="shell">
  <div class="glass"></div>
  <div class="fn">
    <span class="slot"><button class="key fnk prev" type="button"><span class="face"></span>${CHEVRON('l')}</button></span>
    <button class="title" type="button" aria-expanded="false"><span class="roll"><span></span></span></button>
    <span class="slot"><button class="key fnk next" type="button"><span class="face"></span>${CHEVRON('r')}</button></span>
    <span class="slot"><button class="key go today-key" type="button"><span class="face"></span><span class="legend"></span></button></span>
  </div>
  <div class="board">
    <div class="days">
      <div class="week" aria-hidden="true"></div>
      <div class="pad" role="radiogroup"></div>
    </div>
    <div class="months away" role="radiogroup" style="visibility: hidden"></div>
  </div>
  <span class="sr readout" role="status" aria-live="polite"></span>
</div>
`;

interface SlotState {
  key: string | null;
  label: string;
  cls: string[];
}

type View = 'days' | 'months';

/** Below this much horizontal wheel travel (a trackpad swipe) the month does not turn. */
const SWIPE = 60;

const toDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

/**
 * <retro-calendar>: a single-date picker built like an old desk calculator. Every day is a key, and the keys interlock
 * like the station buttons of an old radio: press one and it latches down, and whichever key was down springs back up;
 * press the one that is down again and it springs up too, leaving no date. A lamp over the chosen day's column lights
 * up. The month at the top opens a pad of twelve month keys (the arrows then turn the year). The body is liquid glass
 * and the keys frosted glass, every corner continuous (G2) and every proportion golden.
 *
 * Attributes: value="2026-10-14"  month="2026-10"  min="today"  max="+90"  week-start="0|1"  locale="ja-JP"  theme="light|dark"
 * Events: change (detail: { value }), monthchange (detail: { month })
 */
export class RetroCalendar extends HTMLElement {
  static observedAttributes = ['value', 'month', 'min', 'max', 'week-start', 'locale', 'theme'];

  readonly range = new DayRange();

  private $shell: HTMLElement;
  private $pad: HTMLElement;
  private $months: HTMLElement;
  private $days: HTMLElement;
  private $title: HTMLButtonElement;
  private $roll: HTMLElement;
  private $week: HTMLElement;
  private $readout: HTMLElement;
  private $prev: HTMLButtonElement;
  private $next: HTMLButtonElement;
  private $today: HTMLButtonElement;
  private keys: HTMLButtonElement[] = [];
  private mkeys: HTMLButtonElement[] = [];

  private _value: string | null = null;
  private monthIdx: number;
  private _view: View = 'days';
  /** The year on the month pad. */
  private padYear: number;
  private folded = false;
  private weekStart = 0;
  private locale: string | undefined;
  private slots: SlotState[] = [];
  private focusIdx = -1;
  private mFocus = -1;
  private rendered = false;
  private wheelX = 0;
  private wheelT = 0;
  private wheelSpent = false;
  private press: { el: HTMLButtonElement; id: number; inside: boolean } | null = null;
  private sizer?: ResizeObserver;
  /** The sizes the glass was last shaped for, to leave it be when nothing changed. */
  private glassSig = '';
  private riseGen = 0;
  private viewTimers: number[] = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$shell = q('.shell');
    this.$pad = q('.pad');
    this.$months = q('.months');
    this.$days = q('.days');
    this.$title = q('.title');
    this.$roll = q('.roll');
    this.$week = q('.week');
    this.$readout = q('.readout');
    this.$prev = q('.prev');
    this.$next = q('.next');
    this.$today = q('.today-key');

    for (let i = 0; i < SLOTS; i++) this.keys.push(this.addKey(this.$pad, 'key blank', { i: String(i) }));
    for (let m = 0; m < 12; m++) this.mkeys.push(this.addKey(this.$months, 'key mkey stow', { m: String(m) }));

    const now = new Date();
    this.monthIdx = now.getFullYear() * 12 + now.getMonth();
    this.padYear = now.getFullYear();

    for (const area of [this.$pad, this.$months, q('.fn')]) area.addEventListener('pointerdown', (e) => this.onDown(e as PointerEvent));
    this.$shell.addEventListener('keydown', (e) => this.onShellKey(e));
    this.$pad.addEventListener('keydown', (e) => this.onKey(e));
    this.$months.addEventListener('keydown', (e) => this.onMonthKey(e));
    for (const area of [this.$pad, this.$months]) {
      area.addEventListener('keyup', (e) => this.onKeyUp(e));
      area.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    }
    for (const b of [this.$prev, this.$next, this.$today]) {
      // Keyboard and assistive tech reach these as plain buttons; pointer presses come through onDown/onUp
      b.addEventListener('click', (e) => {
        if ((e as PointerEvent).detail === 0) this.fn(b);
      });
    }
    this.$title.addEventListener('pointerdown', () => this.$shell.classList.add('pointer'));
    this.$title.addEventListener('click', () => this.setView(this._view === 'days' ? 'months' : 'days'));
  }

  private addKey(parent: HTMLElement, cls: string, data: Record<string, string>): HTMLButtonElement {
    const slot = document.createElement('span');
    slot.className = 'slot';
    const key = document.createElement('button');
    key.type = 'button';
    key.className = cls;
    key.setAttribute('role', 'radio');
    key.tabIndex = -1;
    Object.assign(key.dataset, data);
    key.innerHTML = '<span class="face"></span><span class="legend"></span><span class="lamp"></span>';
    slot.append(key);
    parent.append(slot);
    return key;
  }

  connectedCallback(): void {
    if (!this.rendered) this.render(0);
    this.sizer ??= new ResizeObserver(() => this.shapeGlass());
    this.sizer.observe(this.$shell);
  }

  disconnectedCallback(): void {
    this.sizer?.disconnect();
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

  /** Which pad is up: the days, or the twelve months. */
  get view(): View {
    return this._view;
  }

  next(): void {
    this.goto(this.monthIdx + 1);
  }

  prev(): void {
    this.goto(this.monthIdx - 1);
  }

  /** Show a month (YYYY-MM or YYYY-MM-DD); animate false lays it out at once. */
  show(month: string, animate = true): void {
    const m = /^(\d{4})-(\d{1,2})/.exec(month);
    if (m) this.goto(Number(m[1]) * 12 + Number(m[2]) - 1, animate);
  }

  /** Release the key that is down. */
  clear(): void {
    this.choose(null);
  }

  /**
   * Bring up the days or the twelve months: the keys of one pad sink into the body as the other's rise in their place.
   * The month at the top does this when pressed.
   */
  setView(view: View, animate = true): void {
    if (view === this._view) return;
    this._view = view;
    for (const t of this.viewTimers) clearTimeout(t);
    this.viewTimers = [];
    const months = view === 'months';
    if (months) this.padYear = Math.floor(this.monthIdx / 12);
    this.renderMonths(0);
    this.roll(this.$roll, this.titleText(), animate && this.rendered ? (months ? 1 : -1) : 0);
    this.updateFn();
    const [outView, inView] = months ? [this.$days, this.$months] : [this.$months, this.$days];
    const [outKeys, inKeys] = months ? [this.keys, this.mkeys] : [this.mkeys, this.keys];
    this.$title.setAttribute('aria-expanded', String(months));
    inView.style.visibility = '';
    if (!animate || this.folded) {
      this.still(() => {
        outView.classList.add('away');
        inView.classList.remove('away');
        for (const k of outKeys) k.classList.add('stow');
        if (!this.folded) for (const k of inKeys) k.classList.remove('stow');
      });
      outView.style.visibility = 'hidden';
    } else {
      // The keys going away sink, top row first; the grooves and keys of the other pad come up as they go
      outView.style.setProperty('--plate', '0ms');
      inView.style.setProperty('--plate', '140ms');
      outView.classList.add('away');
      inView.classList.remove('away');
      this.stagger(outKeys, true, (k) => (this.rowOf(k) - 1) * 16);
      this.stagger(inKeys, false, (k) => 150 + (this.rowOf(k) - 1) * 36);
      this.viewTimers.push(window.setTimeout(() => (outView.style.visibility = 'hidden'), 520));
    }
    this.syncFocus();
  }

  /** Sink every key flush into the body and fade the print off it: the calculator put away. */
  fold(animate = true): void {
    this.folded = true;
    const keys = this.liveKeys();
    this.$shell.style.setProperty('--plate', '0ms');
    if (!animate) {
      this.still(() => {
        this.$shell.classList.add('folded');
        for (const k of keys) k.classList.add('stow');
      });
      return;
    }
    this.$shell.classList.add('folded');
    const rows = Math.max(...keys.map((k) => this.rowOf(k)));
    this.stagger(keys, true, (k) => (rows - this.rowOf(k)) * 14);
  }

  /** Raise the keys again, row after row from the top, beginning delay ms from now. */
  unfold(delay = 0): void {
    this.folded = false;
    for (const v of [this.$days, this.$months]) v.style.removeProperty('--plate');
    this.$shell.style.setProperty('--plate', `${delay}ms`);
    this.$shell.classList.remove('folded');
    this.stagger(this.liveKeys(), false, (k) => delay + this.rowOf(k) * 34);
  }

  /** Focus goes to the key the keyboard would start from: the one that is down, or today, or this month. */
  focus(options?: FocusOptions): void {
    const el = this._view === 'months' ? this.mkeys[this.mFocus] : this.keys[this.focusIdx];
    if (el) el.focus(options);
    else super.focus(options);
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

  private goto(k: number, animate = true): void {
    k = this.clampMonth(k);
    if (!this.rendered) {
      this.monthIdx = k;
      return;
    }
    if (k === this.monthIdx) return;
    const dir = Math.sign(k - this.monthIdx);
    this.monthIdx = k;
    // (the days only roll over when they are up to be seen)
    this.render(animate && this._view === 'days' && !this.folded ? dir : 0);
    this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  /** On the month pad, the arrows turn the year. */
  private stepYear(d: number): void {
    const y = Math.min(Math.floor(this.range.maxMonth / 12), Math.max(Math.floor(this.range.minMonth / 12), this.padYear + d));
    if (y === this.padYear) return;
    const dir = Math.sign(y - this.padYear);
    this.padYear = y;
    this.roll(this.$roll, this.titleText(), dir);
    this.renderMonths(dir);
    this.updateFn();
    this.syncFocus();
  }

  /** A month key pressed home: it latches (the one that was down springs up), and a beat later the days come back for it. */
  private pickMonth(el: HTMLButtonElement): void {
    const k = Number(el.dataset.k);
    if (k !== this.monthIdx) {
      el.classList.add('latched');
      this.goto(k, false);
    }
    for (const t of this.viewTimers) clearTimeout(t);
    this.viewTimers = [window.setTimeout(() => this.setView('days'), 240)];
  }

  // ---------- Drawing ----------

  private words(): Words {
    const lang = (this.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase();
    return WORDS[lang.slice(0, 2)] ?? WORDS.en;
  }

  /** What the top of the calculator reads: the month on the day keys, or the year on the month keys. */
  private titleText(): string {
    if (this._view === 'months') return new Intl.DateTimeFormat(this.locale, { year: 'numeric' }).format(new Date(this.padYear, 0, 1));
    return new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' }).format(
      new Date(Math.floor(this.monthIdx / 12), this.monthIdx % 12, 1),
    );
  }

  /** Lay the month out on the keys. dir is -1 / 1 when turning to an earlier / later month, 0 for no animation. */
  private render(dir: number): void {
    this.range.refresh();
    const y = Math.floor(this.monthIdx / 12);
    const m0 = this.monthIdx % 12;
    const now = new Date();
    const today = keyOf(now.getFullYear(), now.getMonth(), now.getDate());

    if (this._view === 'days') this.roll(this.$roll, this.titleText(), dir);
    else this.renderMonths(0);
    // The weekday heads in the reader's own letters: S M T W T F S, 日 月 火 水 木 金 土, 日 一 二 三 四 五 六
    const narrow = new Intl.DateTimeFormat(this.locale, { weekday: 'narrow' });
    let heads = '';
    for (let i = 0; i < 7; i++) {
      const n = (this.weekStart + i) % 7;
      // 2023-01-01 was a Sunday
      heads += `<span class="${n === 0 ? 'sun' : n === 6 ? 'sat' : ''}" data-wd="${n}">${narrow.format(new Date(2023, 0, 1 + n))}</span>`;
    }
    if (this.$week.dataset.sig !== heads) {
      this.$week.innerHTML = heads;
      this.$week.dataset.sig = heads;
    }
    this.updateFn();
    this.$pad.setAttribute('aria-label', new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' }).format(new Date(y, m0, 1)));

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
      const legend = el.querySelector('.legend') as HTMLElement;
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
      this.rollLegend(legend, dir, (dir > 0 ? i : SLOTS - 1 - i) * 5, paint);
    });
    this.rendered = true;
    this.sync();
  }

  /** The twelve month keys for the year on the pad. */
  private renderMonths(dir: number): void {
    const now = new Date();
    const short = new Intl.DateTimeFormat(this.locale, { month: 'short' });
    const full = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' });
    const states = monthKeys(this.padYear, this.monthIdx, now.getFullYear() * 12 + now.getMonth(), this.range.minMonth, this.range.maxMonth);
    states.forEach((s, m) => {
      const el = this.mkeys[m];
      const legend = el.querySelector('.legend') as HTMLElement;
      el.dataset.k = String(s.index);
      el.setAttribute('aria-label', full.format(new Date(this.padYear, m, 1)));
      el.setAttribute('aria-checked', String(s.latched));
      el.setAttribute('aria-disabled', String(s.off));
      if (el !== this.press?.el) {
        if (s.latched) el.classList.add('latched');
        // (the interlock: the key that was down springs up a beat after the new one passes the catch)
        else if (el.classList.contains('latched')) setTimeout(() => el.getAttribute('aria-checked') === 'false' && el.classList.remove('latched'), 45);
      }
      const paint = () => {
        legend.textContent = short.format(new Date(this.padYear, m, 1)).replace(/\.$/, '');
        el.classList.toggle('today', s.current);
        el.classList.toggle('past', s.past);
        el.classList.toggle('off', s.off);
      };
      for (const a of legend.getAnimations()) a.cancel();
      if (dir && legend.textContent) this.rollLegend(legend, dir, m * 12, paint);
      else paint();
    });
    this.$months.setAttribute('aria-label', this.titleText());
  }

  /** The arrows, Today and the title's words, for the pad that is up and how far the range lets the arrows go. */
  private updateFn(): void {
    const w = this.words();
    const months = this._view === 'months';
    this.$prev.disabled = months ? this.padYear <= Math.floor(this.range.minMonth / 12) : this.monthIdx <= this.range.minMonth;
    this.$next.disabled = months ? this.padYear >= Math.floor(this.range.maxMonth / 12) : this.monthIdx >= this.range.maxMonth;
    this.$prev.setAttribute('aria-label', months ? w.prevYear : w.prev);
    this.$next.setAttribute('aria-label', months ? w.nextYear : w.next);
    const todayLegend = this.$today.querySelector('.legend')!;
    todayLegend.textContent = w.today;
    // A word like "Today" needs a smaller print than 今日 to fit the key
    todayLegend.classList.toggle('long', w.today.length > 2);
    this.$title.setAttribute('aria-label', `${this.titleText()}, ${months ? w.days : w.months}`);
  }

  /**
   * Cut the body and the keys to Apple's continuous corners at their real sizes, light their rims along those edges, and
   * (where the browser can) draw the maps that bend the view through the glass. Every day key is the same size, and so
   * is every month key, so one map serves each.
   */
  private shapeGlass(): void {
    const key = this.keys[0];
    const mkey = this.mkeys[0];
    const slot = key.parentElement!;
    const body = { w: this.$shell.offsetWidth, h: this.$shell.offsetHeight };
    const k = { w: key.offsetWidth, h: key.offsetHeight };
    const mk = { w: mkey.offsetWidth, h: mkey.offsetHeight };
    if (!body.w || !k.w) return;
    const sig = [body.w, body.h, k.w, k.h, mk.w, mk.h].join();
    if (sig === this.glassSig) return;
    this.glassSig = sig;

    // The radii as the stylesheet sets them: the key's 1/φ³ of its height, and each one further out concentric with it
    const pad = parseFloat(getComputedStyle(this.$shell).paddingTop);
    const lip = (slot.offsetWidth - k.w) / 2;
    const rKey = k.h * 0.236;
    const rBody = rKey + lip + pad;
    const keyEdge = roundedRect(k.w, k.h, rKey);
    const mkeyEdge = roundedRect(mk.w, mk.h, rKey);
    const bodyEdge = roundedRect(body.w, body.h, rBody);
    const s = this.$shell.style;
    s.setProperty('--g2-key', `path('${keyEdge}')`);
    s.setProperty('--g2-mkey', `path('${mkeyEdge}')`);
    s.setProperty('--g2-body', `path('${bodyEdge}')`);
    s.setProperty('--rim-key', rim(k.w, k.h, keyEdge));
    s.setProperty('--rim-mkey', rim(mk.w, mk.h, mkeyEdge));
    s.setProperty('--rim-body', rim(body.w, body.h, bodyEdge, 0.85));

    if (!CAN_BEND) return;
    const lens = (id: string, w: number, h: number, edge: string, bezel: number, shift: number) => {
      const map = lensMap(w, h, edge, bezel);
      if (!map) return false;
      const f = this.shadowRoot!.getElementById(id)!;
      const img = f.querySelector('feImage')!;
      for (const el of [f, img]) {
        el.setAttribute('width', String(Math.ceil(w)));
        el.setAttribute('height', String(Math.ceil(h)));
      }
      img.setAttribute('href', map);
      f.querySelector('feDisplacementMap')!.setAttribute('scale', String(shift * 2));
      return true;
    };
    const bentBody = lens('lens-body', body.w, body.h, bodyEdge, pad * BODY_BEZEL, pad * BODY_SHIFT);
    const bentKeys = lens('lens-key', k.w, k.h, keyEdge, k.h * KEY_BEZEL, k.h * KEY_SHIFT);
    const bentMonths = !!mk.w && lens('lens-mkey', mk.w, mk.h, mkeyEdge, k.h * KEY_BEZEL, k.h * KEY_SHIFT);
    this.$shell.querySelector('.glass')!.classList.toggle('bend', bentBody);
    this.$shell.classList.toggle('bend', bentKeys);
    this.$shell.classList.toggle('bend-m', bentMonths);
  }

  /** Swap a printed label with a short vertical roll in the direction of travel. */
  private roll(box: HTMLElement, text: string, dir: number): void {
    const cur = box.lastElementChild as HTMLElement;
    const up = this._view === 'months';
    if (cur.dataset.text === text && !!cur.querySelector('.caret.up') === up) return;
    const fill = (span: HTMLElement) => {
      span.dataset.text = text;
      span.textContent = text;
      span.insertAdjacentHTML('beforeend', CARET);
      span.lastElementChild!.classList.toggle('up', up);
    };
    if (!dir || !cur.dataset.text) {
      fill(cur);
      return;
    }
    const next = document.createElement('span');
    fill(next);
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

  /** A key's legend rolls over like a drum: out one way, the new one in from the other. */
  private rollLegend(legend: HTMLElement, dir: number, delay: number, paint: () => void): void {
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
  }

  /** Sink (or raise) keys, each after its own delay; the delays are dropped again once they have all moved. */
  private stagger(els: HTMLElement[], stow: boolean, delay: (el: HTMLElement) => number): void {
    const gen = String(++this.riseGen);
    let last = 0;
    for (const el of els) {
      const d = Math.max(0, Math.round(delay(el)));
      last = Math.max(last, d);
      el.style.setProperty('--rise', `${d}ms`);
      el.dataset.gen = gen;
      el.classList.toggle('stow', stow);
    }
    window.setTimeout(() => {
      for (const el of els) if (el.dataset.gen === gen) el.style.removeProperty('--rise');
    }, last + 700);
  }

  /** Change the classes at once, with no transitions. */
  private still(fn: () => void): void {
    this.$shell.classList.add('still');
    fn();
    void this.$shell.offsetWidth;
    this.$shell.classList.remove('still');
  }

  /** The row a key sits in, counting the top row (the arrows and Today) as 0. */
  private rowOf(el: HTMLElement): number {
    if (el.dataset.i !== undefined) return 1 + Math.floor(Number(el.dataset.i) / 7);
    if (el.dataset.m !== undefined) return 1 + Math.floor(Number(el.dataset.m) / 3);
    return 0;
  }

  /** The keys that are up: the top row and the pad that is showing. */
  private liveKeys(): HTMLButtonElement[] {
    return [this.$prev, this.$next, this.$today, ...(this._view === 'days' ? this.keys : this.mkeys)];
  }

  /** Bring the keys, the weekday lamp and the readout in line with the value. */
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
    if (latchedIdx >= 0) this.focusIdx = latchedIdx;
    this.syncFocus();
    // The lamp over the chosen day's column, lit while that day is on the keys
    const wd = latchedIdx >= 0 ? (this.weekStart + latchedIdx) % 7 : -1;
    for (const s of this.$week.children) s.classList.toggle('lit', Number((s as HTMLElement).dataset.wd) === wd);
    this.$readout.textContent = v ? new Intl.DateTimeFormat(this.locale, { dateStyle: 'full' }).format(toDate(v)) : this.words().none;
  }

  /** One key in each pad takes the Tab key: the one that is down, else today (this month), else the first there is. */
  private syncFocus(): void {
    if (this.focusIdx < 0 || !this.slots[this.focusIdx]?.key) {
      const latched = this.keys.findIndex((k) => k.classList.contains('latched'));
      const today = this.keys.findIndex((k) => k.classList.contains('today'));
      this.focusIdx = latched >= 0 ? latched : today >= 0 ? today : this.slots.findIndex((s) => s.key);
    }
    this.keys.forEach((el, i) => (el.tabIndex = this._view === 'days' && i === this.focusIdx ? 0 : -1));
    const shown = this.mkeys.findIndex((k) => k.getAttribute('aria-checked') === 'true');
    const current = this.mkeys.findIndex((k) => k.classList.contains('today'));
    if (this.mFocus < 0 || this.mkeys[this.mFocus]?.getAttribute('aria-disabled') === 'true') {
      this.mFocus = shown >= 0 ? shown : current >= 0 ? current : Math.max(0, this.mkeys.findIndex((k) => k.getAttribute('aria-disabled') !== 'true'));
    }
    this.mkeys.forEach((el, i) => (el.tabIndex = this._view === 'months' && i === this.mFocus ? 0 : -1));
  }

  // ---------- Input ----------

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || this.press) return;
    const el = (e.target as Element).closest<HTMLButtonElement>('.key');
    if (!el || el.classList.contains('blank') || el.classList.contains('stow')) return;
    e.preventDefault();
    if (el.disabled || el.classList.contains('off')) {
      this.jam(el);
      return;
    }
    // Focus follows the finger, but the keyboard ring stays away until a key on the keyboard is used
    this.$shell.classList.add('pointer');
    el.focus({ preventScroll: true });
    el.style.removeProperty('--rise');
    if (el.dataset.i) this.focusIdx = Number(el.dataset.i);
    if (el.dataset.m) this.mFocus = Number(el.dataset.m);
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

  /**
   * A key comes up off the bottom: a day key latches (and throws out the old one), or, if it was the one already down,
   * lets go and springs up with no date chosen; a month key brings back the days for its month; a function key does
   * its job.
   */
  private release(el: HTMLButtonElement): void {
    if (el.dataset.i !== undefined) {
      const key = el.dataset.key || null;
      if (!key) return;
      if (key === this._value) {
        this.choose(null);
        return;
      }
      el.classList.add('latched');
      this.choose(key, 45);
    } else if (el.dataset.m !== undefined) {
      this.pickMonth(el);
    } else {
      this.fn(el);
    }
  }

  private fn(el: HTMLButtonElement): void {
    const months = this._view === 'months';
    if (el === this.$prev) {
      if (months) this.stepYear(-1);
      else this.prev();
    } else if (el === this.$next) {
      if (months) this.stepYear(1);
      else this.next();
    } else if (el === this.$today) {
      const now = new Date();
      this.goto(now.getFullYear() * 12 + now.getMonth());
      this.setView('days');
    }
  }

  private jam(el: HTMLElement): void {
    el.classList.remove('jam');
    void el.offsetWidth;
    el.classList.add('jam');
    el.addEventListener('animationend', () => el.classList.remove('jam'), { once: true });
  }

  /** Escape on the month pad puts the days back (and goes no further, so a popup holding the calculator stays open). */
  private onShellKey(e: KeyboardEvent): void {
    this.$shell.classList.remove('pointer');
    if (e.key === 'Escape' && this._view === 'months') {
      e.preventDefault();
      e.stopPropagation();
      this.setView('days');
      this.focus({ preventScroll: true });
    }
  }

  /** Space or Enter presses a key: it goes down, and comes up on keyup (Enter: a moment later). */
  private pressKey(e: KeyboardEvent, el: HTMLButtonElement): void {
    e.preventDefault();
    if (e.repeat) return;
    if (el.classList.contains('off')) return this.jam(el);
    el.style.removeProperty('--rise');
    el.classList.add('down');
    if (e.key === 'Enter') setTimeout(() => this.keyUp(el), 110);
  }

  /** Arrow keys walk the keys (across into the next or previous month at the edges); Enter / Space press one. */
  private onKey(e: KeyboardEvent): void {
    const el = (e.target as Element).closest<HTMLButtonElement>('.key');
    if (!el || el.dataset.i === undefined) return;
    if (e.key === 'Enter' || e.key === ' ') return this.pressKey(e, el);
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

  /** On the month pad: arrows move between the months, Page Up / Page Down turn the year, Enter / Space press. */
  private onMonthKey(e: KeyboardEvent): void {
    const el = (e.target as Element).closest<HTMLButtonElement>('.mkey');
    if (!el) return;
    if (e.key === 'Enter' || e.key === ' ') return this.pressKey(e, el);
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      this.stepYear(e.key === 'PageUp' ? -1 : 1);
      this.mkeys[this.mFocus]?.focus({ preventScroll: true });
      return;
    }
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    const m = Number(el.dataset.m) + step;
    if (m < 0 || m > 11) return;
    this.mFocus = m;
    this.mkeys.forEach((k, i) => (k.tabIndex = i === m ? 0 : -1));
    this.mkeys[m].focus({ preventScroll: true });
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

  /** Two-finger sideways swipe on a trackpad turns the month (on the month pad, the year). */
  private onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const t = performance.now();
    if (t - this.wheelT > 300) {
      this.wheelX = 0;
      this.wheelSpent = false;
    }
    this.wheelT = t;
    // One step per swipe: the rest of the gesture's momentum is swallowed
    if (this.wheelSpent) return;
    this.wheelX += e.deltaX;
    if (Math.abs(this.wheelX) >= SWIPE) {
      this.wheelSpent = true;
      const dir = Math.sign(this.wheelX);
      if (this._view === 'months') this.stepYear(dir);
      else this.goto(this.monthIdx + dir);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'retro-calendar': RetroCalendar;
  }
}
