import { DayRange } from '../shared/range';
import { monthKeys } from './keypad';
import { roundedRect } from '../shared/g2';

/* ---------- Words on the faceplate, in the reader's language ---------- */

export interface Words {
  today: string;
  prev: string;
  next: string;
  prevYear: string;
  nextYear: string;
  months: string;
  days: string;
  none: string;
}

export const WORDS: Record<string, Words> = {
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

export const MINCHO = `"Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Noto Serif JP", "Songti SC", serif`;

/** The calculator's look, shared by <retro-calendar> and <retro-frame>: the one source of it. */
export const SHELL_STYLE = /* css */ `
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
  /* The unit everything is measured in: 1% of the calculator's own width (a frame caps it; two months side by side halve it) */
  --u: 1cqi;
  --g: calc(2 * var(--u));
  --pad: calc(var(--g) * 2.618);
  --lip: calc(var(--g) * 0.236);
  --kw: calc((calc(100 * var(--u)) - 2 * var(--pad) - 6 * var(--g)) / 7 - 2 * var(--lip));
  --kh: calc(var(--kw) * 0.809);
  --r: calc(var(--kh) * 0.236);
  --t: calc(var(--kh) * 0.146);
  /* A key's slot, groove and all, for rows that are not the seven-column day grid */
  --slot-w: calc(var(--kw) + 2 * var(--lip));
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  padding: var(--pad);
  border-radius: calc(var(--r) + var(--lip) + var(--pad));
  /* Only the shadow belongs to the shell itself: the glass is a layer of its own under the keys, so that each key's own
     glass sees (and bends) the body's glass and whatever is behind the calculator */
  box-shadow:
    0 0 0 0.5px var(--outline),
    0 calc(0.6 * var(--u)) calc(1.4 * var(--u)) calc(-0.4 * var(--u)) var(--drop),
    0 calc(5 * var(--u)) calc(9 * var(--u)) calc(-3 * var(--u)) var(--drop),
    0 calc(4 * var(--u)) calc(16 * var(--u)) calc(-2 * var(--u)) var(--drop-wide);
}
.glass {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  clip-path: var(--g2-body, none);
  background: var(--body-tint);
  -webkit-backdrop-filter: blur(14px) saturate(1.7);
  backdrop-filter: blur(14px) saturate(1.7);
  box-shadow: inset 0 0 calc(2.4 * var(--u)) rgba(255, 255, 255, 0.16);
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
.title:active .roll { transform: translateY(calc(0.25 * var(--u))); }
.roll > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(0.9 * var(--u));
  white-space: nowrap;
  font-family: ${MINCHO};
  font-size: calc(3.9 * var(--u));
  font-weight: 600;
  letter-spacing: 0.08em;
}
.caret { flex: none; width: calc(2.5 * var(--u)); height: calc(2.5 * var(--u)); opacity: 0.5; }
.caret.up { transform: rotate(180deg); }

/* ---------- The pads: the days, and in their place on demand the twelve months ---------- */
.board { position: relative; }
.months {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: var(--g);
}
.slot {
  /* The groove in the glass the key rides in */
  padding: var(--lip) var(--lip) calc(var(--t) + var(--lip));
  border-radius: calc(var(--r) + var(--lip));
  background-color: var(--groove);
  box-shadow: inset 0 calc(0.3 * var(--u)) calc(0.7 * var(--u)) rgba(0, 0, 0, 0.14), 0 calc(0.15 * var(--u)) 0 rgba(255, 255, 255, 0.3);
  transition: background-color 0.3s ease var(--plate, 0s), box-shadow 0.3s ease var(--plate, 0s);
}
/* A pad put away, or the whole calculator folded: smooth glass, no grooves */
.away .slot, .folded .slot { background-color: transparent; box-shadow: none; }
.folded .roll { opacity: 0; }

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
    0 calc(var(--t) + calc(0.4 * var(--u))) calc(1.1 * var(--u)) rgba(0, 0, 0, 0.18);
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
  box-shadow: inset 0 calc(-0.5 * var(--u)) calc(1 * var(--u)) rgba(255, 255, 255, 0.14), inset 0 calc(0.5 * var(--u)) calc(1 * var(--u)) rgba(255, 255, 255, 0.18);
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
    0 calc(var(--t) * 0.2 + calc(0.2 * var(--u))) calc(0.9 * var(--u)) rgba(255, 170, 0, 0.35);
  transition: box-shadow 0.2s cubic-bezier(0.2, 0.7, 0.3, 1);
}
.key.down { transform: translateY(var(--t)); transition: transform 0.075s cubic-bezier(0.5, 0, 0.9, 0.5); }
.key.down::before {
  box-shadow:
    0 0 0 var(--edge),
    0 calc(0.15 * var(--u)) calc(0.35 * var(--u)) rgba(0, 0, 0, 0.2);
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
  border: calc(0.45 * var(--u)) solid var(--sunflower-deep);
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
.mkey .legend { font-size: calc(3.6 * var(--u)); letter-spacing: 0.02em; }
.key.blank .legend, .key.blank .lamp { opacity: 0; }
/* Today (and this month): a pinhead lamp under the number, lit the same yellow as the weekday lamps */
.key .lamp {
  position: absolute;
  bottom: 13%;
  left: 50%;
  width: calc(1 * var(--u));
  height: calc(1 * var(--u));
  margin-left: calc(-0.5 * var(--u));
  border-radius: 50%;
  background: #8a6a12;
  opacity: 0;
  transition: opacity 0.4s ease, background-color 0.4s ease, box-shadow 0.4s ease;
}
.key.today .lamp {
  opacity: 1;
  background: #ffd43a;
  box-shadow: 0 0 calc(0.5 * var(--u)) #ffbe0d, 0 0 calc(1.4 * var(--u)) rgba(255, 190, 13, 0.7);
}
.key.today.latched .lamp { background: #fff6d6; box-shadow: 0 0 calc(0.5 * var(--u)) #fff; }
/* Function keys, momentary (they always spring back): smoked glass for the arrows, the sunflower yellow for Today */
.key.fnk { --tint: var(--smoke-tint); --edge: rgba(0, 0, 0, 0.3); color: #f6f3ec; }
.key.go { --tint: linear-gradient(180deg, rgba(255, 214, 60, 0.95), rgba(255, 196, 10, 0.86)); --edge: rgba(190, 130, 0, 0.5); color: var(--ink); }
.key.fnk .legend, .key.go .legend { font-size: calc(3 * var(--u)); font-weight: 700; letter-spacing: 0.04em; }
.key.go .legend.long { font-size: calc(2.4 * var(--u)); letter-spacing: 0; }
.key svg { position: relative; width: calc(3.4 * var(--u)); height: calc(3.4 * var(--u)); pointer-events: none; transition: opacity 0.26s ease; }
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

export const CARET = `<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

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

/**
 * The calculator's body around whatever it holds: the glass, the top row (the arrows either side of the month, Today at
 * the end) and, in the board, the given body with the twelve month keys over it on demand.
 */
function shellTemplate(style: string, body: string): string {
  return `
<style>${SHELL_STYLE}${style}</style>
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
    ${body}
    <div class="months away" role="radiogroup" style="visibility: hidden"></div>
  </div>
  <span class="sr readout" role="status" aria-live="polite"></span>
</div>
`;
}

export type View = 'days' | 'months';

/** Why the month changed: an arrow, Today, a month key, a trackpad swipe, the keyboard, a new value, or the page. */
export type MonthChangeReason = 'prev' | 'next' | 'today' | 'pick' | 'swipe' | 'keyboard' | 'value' | 'range' | 'api';

/** Below this much horizontal wheel travel (a trackpad swipe) the month does not turn. */
const SWIPE = 60;

/**
 * The shared part of the calculator: its liquid-glass body, the month at the top (which opens a pad of twelve month
 * keys, the arrows then turning the year), the arrows, Today, the key mechanics and the glass shaping. <retro-calendar>
 * fills the board with day keys; <retro-frame> with whatever the page puts in it. Kept as the one source of the look.
 *
 * Events: monthchange (detail: { month, reason })
 */
export abstract class RetroShell extends HTMLElement {
  readonly range = new DayRange();

  protected $shell: HTMLElement;
  protected $board: HTMLElement;
  protected $months: HTMLElement;
  protected $fn: HTMLElement;
  protected $title: HTMLButtonElement;
  protected $roll: HTMLElement;
  protected $readout: HTMLElement;
  protected $prev: HTMLButtonElement;
  protected $next: HTMLButtonElement;
  protected $today: HTMLButtonElement;
  protected mkeys: HTMLButtonElement[] = [];

  protected monthIdx: number;
  protected _view: View = 'days';
  /** The year on the month pad. */
  protected padYear: number;
  protected folded = false;
  protected locale: string | undefined;
  protected mFocus = -1;
  protected rendered = false;
  protected press: { el: HTMLButtonElement; id: number; inside: boolean } | null = null;
  protected viewTimers: number[] = [];
  private wheelX = 0;
  private wheelT = 0;
  private wheelSpent = false;
  private sizer?: ResizeObserver;
  /** The sizes the glass was last shaped for, to leave it be when nothing changed. */
  private glassSig = '';
  private riseGen = 0;

  constructor(style: string, body: string) {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = shellTemplate(style, body);
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$shell = q('.shell');
    this.$board = q('.board');
    this.$months = q('.months');
    this.$fn = q('.fn');
    this.$title = q('.title');
    this.$roll = q('.roll');
    this.$readout = q('.readout');
    this.$prev = q('.prev');
    this.$next = q('.next');
    this.$today = q('.today-key');

    for (let m = 0; m < 12; m++) this.mkeys.push(this.addKey(this.$months, 'key mkey stow', { m: String(m) }));

    const now = new Date();
    this.monthIdx = now.getFullYear() * 12 + now.getMonth();
    this.padYear = now.getFullYear();

    for (const area of [this.$months, this.$fn]) area.addEventListener('pointerdown', (e) => this.onDown(e as PointerEvent));
    this.$shell.addEventListener('keydown', (e) => this.onShellKey(e));
    this.$months.addEventListener('keydown', (e) => this.onMonthKey(e));
    this.$months.addEventListener('keyup', (e) => this.onKeyUp(e));
    this.$months.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    for (const b of [this.$prev, this.$next, this.$today]) {
      // Keyboard and assistive tech reach these as plain buttons; pointer presses come through onDown/onUp
      b.addEventListener('click', (e) => {
        if ((e as PointerEvent).detail === 0) this.fn(b);
      });
    }
    this.$title.addEventListener('pointerdown', () => this.$shell.classList.add('pointer'));
    this.$title.addEventListener('click', () => this.setView(this._view === 'days' ? 'months' : 'days'));
  }

  /** A pad of keys the board holds (the day keys): pressed, walked with the keyboard and swiped like the month keys. */
  protected listenPad(pad: HTMLElement): void {
    pad.addEventListener('pointerdown', (e) => this.onDown(e as PointerEvent));
    pad.addEventListener('keydown', (e) => this.onBodyKey(e));
    pad.addEventListener('keyup', (e) => this.onKeyUp(e));
    pad.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  protected addKey(parent: HTMLElement, cls: string, data: Record<string, string>): HTMLButtonElement {
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
      case 'month':
        if (v && /^\d{4}-\d{1,2}$/.test(v)) this.show(v);
        break;
      case 'min':
      case 'max':
        this.range.set(name, v);
        this.applyRange();
        break;
      case 'locale':
        this.locale = v ?? undefined;
        if (this.rendered) this.render(0);
        break;
    }
  }

  // ---------- Public API ----------

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

  /** The month shown (the first one, when the calculator shows two), YYYY-MM. */
  get month(): string {
    return `${Math.floor(this.monthIdx / 12)}-${String((this.monthIdx % 12) + 1).padStart(2, '0')}`;
  }

  /** Which pad is up: the body, or the twelve months. */
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

  /**
   * Bring up the body or the twelve months: the keys of one pad sink into the body as the other's rise in their place.
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
    const body = this.bodyView();
    const [outView, inView] = months ? [body, this.$months] : [this.$months, body];
    const [outKeys, inKeys] = months ? [this.bodyKeys(), this.mkeys] : [this.mkeys, this.bodyKeys()];
    this.$title.setAttribute('aria-expanded', String(months));
    this.$shell.classList.toggle('months-up', months);
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
    for (const v of [this.bodyView(), this.$months]) v.style.removeProperty('--plate');
    this.$shell.style.setProperty('--plate', `${delay}ms`);
    this.$shell.classList.remove('folded');
    this.stagger(this.liveKeys(), false, (k) => delay + this.rowOf(k) * 34);
  }

  /** Focus goes to the month key the keyboard would start from on the month pad, else to the month at the top. */
  focus(options?: FocusOptions): void {
    const el = this._view === 'months' ? this.mkeys[this.mFocus] : this.$title;
    if (el) el.focus(options);
    else super.focus(options);
  }

  // ---------- What the body supplies ----------

  /** Lay the body out for the month. dir is -1 / 1 when turning to an earlier / later month, 0 for no animation. */
  protected abstract render(dir: number): void;

  /** The part of the board that gives way to the month keys. */
  protected abstract bodyView(): HTMLElement;

  /** The body's own keys, which sink and rise with the pads. */
  protected bodyKeys(): HTMLButtonElement[] {
    return [];
  }

  /** How many months the body shows side by side or one above the other. */
  protected monthsShown(): number {
    return 1;
  }

  /** The key whose size the key glass is shaped for. */
  protected glassKey(): HTMLElement {
    return this.$prev;
  }

  /** A key of the body came up off the bottom. */
  protected releaseBody(_el: HTMLButtonElement): void {}

  /** A key of the body handles the keyboard. */
  protected onBodyKey(_e: KeyboardEvent): void {}

  /** The row a key of the body sits in, counting the top row (the arrows and Today) as 0. */
  protected bodyRow(_el: HTMLElement): number {
    return 1;
  }

  /** Before the glass is measured, after a resize: for the body to size what depends on its layout. */
  protected beforeShape(): void {}

  // ---------- Months ----------

  protected applyRange(): void {
    this.range.refresh();
    const clamped = this.clampMonth(this.monthIdx);
    this.rangeApplied();
    if (!this.rendered) {
      this.monthIdx = clamped;
      return;
    }
    if (clamped !== this.monthIdx) this.goto(clamped, true, 'range');
    else this.render(0);
  }

  /** The range changed: for the body to drop what it no longer allows. */
  protected rangeApplied(): void {}

  /** The first month shown, kept so that every month shown lies within min / max. */
  protected clampMonth(k: number): number {
    return Math.max(this.range.minMonth, Math.min(this.range.maxMonth - this.monthsShown() + 1, k));
  }

  protected goto(k: number, animate = true, reason: MonthChangeReason = 'api'): void {
    k = this.clampMonth(k);
    if (!this.rendered) {
      this.monthIdx = k;
      return;
    }
    if (k === this.monthIdx) return;
    const dir = Math.sign(k - this.monthIdx);
    this.monthIdx = k;
    // (the body only rolls over when it is up to be seen)
    this.render(animate && this._view === 'days' && !this.folded ? dir : 0);
    this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month, reason }, bubbles: true, composed: true }));
  }

  /** On the month pad, the arrows turn the year. */
  protected stepYear(d: number): void {
    const y = Math.min(Math.floor(this.range.maxMonth / 12), Math.max(Math.floor(this.range.minMonth / 12), this.padYear + d));
    if (y === this.padYear) return;
    const dir = Math.sign(y - this.padYear);
    this.padYear = y;
    this.roll(this.$roll, this.titleText(), dir);
    this.renderMonths(dir);
    this.updateFn();
    this.syncFocus();
  }

  /** A month key pressed home: it latches (the one that was down springs up), and a beat later the body comes back for it. */
  protected pickMonth(el: HTMLButtonElement): void {
    const k = Number(el.dataset.k);
    if (k !== this.monthIdx) {
      el.classList.add('latched');
      this.goto(k, false, 'pick');
    }
    for (const t of this.viewTimers) clearTimeout(t);
    this.viewTimers = [window.setTimeout(() => this.setView('days'), 240)];
  }

  // ---------- Drawing ----------

  protected words(): Words {
    const lang = (this.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase();
    return WORDS[lang.slice(0, 2)] ?? WORDS.en;
  }

  /** What the top of the calculator reads: the month shown, or the year on the month keys. */
  protected titleText(): string {
    if (this._view === 'months') return new Intl.DateTimeFormat(this.locale, { year: 'numeric' }).format(new Date(this.padYear, 0, 1));
    return new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' }).format(
      new Date(Math.floor(this.monthIdx / 12), this.monthIdx % 12, 1),
    );
  }

  /** The twelve month keys for the year on the pad. */
  protected renderMonths(dir: number): void {
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
  protected updateFn(): void {
    const w = this.words();
    const months = this._view === 'months';
    const last = this.monthIdx + this.monthsShown() - 1;
    this.$prev.disabled = months ? this.padYear <= Math.floor(this.range.minMonth / 12) : this.monthIdx <= this.range.minMonth;
    this.$next.disabled = months ? this.padYear >= Math.floor(this.range.maxMonth / 12) : last >= this.range.maxMonth;
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
   * (where the browser can) draw the maps that bend the view through the glass. Every key of a kind is the same size,
   * so one map serves each.
   */
  protected shapeGlass(): void {
    this.beforeShape();
    const key = this.glassKey();
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
  protected roll(box: HTMLElement, text: string, dir: number): void {
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
  protected rollLegend(legend: HTMLElement, dir: number, delay: number, paint: () => void): void {
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
  protected stagger(els: HTMLElement[], stow: boolean, delay: (el: HTMLElement) => number): void {
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
  protected still(fn: () => void): void {
    this.$shell.classList.add('still');
    fn();
    void this.$shell.offsetWidth;
    this.$shell.classList.remove('still');
  }

  /** The row a key sits in, counting the top row (the arrows and Today) as 0. */
  protected rowOf(el: HTMLElement): number {
    if (el.dataset.m !== undefined) return 1 + Math.floor(Number(el.dataset.m) / 3);
    if (el.dataset.i !== undefined) return this.bodyRow(el);
    return 0;
  }

  /** The keys that are up: the top row and the pad that is showing. */
  protected liveKeys(): HTMLButtonElement[] {
    return [this.$prev, this.$next, this.$today, ...(this._view === 'days' ? this.bodyKeys() : this.mkeys)];
  }

  /** One month key takes the Tab key: the month shown, else this month, else the first there is. */
  protected syncFocus(): void {
    const shown = this.mkeys.findIndex((k) => k.getAttribute('aria-checked') === 'true');
    const current = this.mkeys.findIndex((k) => k.classList.contains('today'));
    if (this.mFocus < 0 || this.mkeys[this.mFocus]?.getAttribute('aria-disabled') === 'true') {
      this.mFocus = shown >= 0 ? shown : current >= 0 ? current : Math.max(0, this.mkeys.findIndex((k) => k.getAttribute('aria-disabled') !== 'true'));
    }
    this.mkeys.forEach((el, i) => (el.tabIndex = this._view === 'months' && i === this.mFocus ? 0 : -1));
  }

  // ---------- Input ----------

  protected onDown(e: PointerEvent): void {
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
    this.pressed(el);
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
      else this.afterCancel();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** A key went down under the finger: the keyboard starts from it next time. */
  protected pressed(el: HTMLButtonElement): void {
    if (el.dataset.m) this.mFocus = Number(el.dataset.m);
  }

  /** A press slid off its key and was let go: put the keys back as they were. */
  protected afterCancel(): void {}

  /**
   * A key comes up off the bottom: a month key brings back the body for its month, a function key does its job, and a
   * key of the body is the body's.
   */
  protected release(el: HTMLButtonElement): void {
    if (el.dataset.m !== undefined) this.pickMonth(el);
    else if (el.dataset.i !== undefined) this.releaseBody(el);
    else this.fn(el);
  }

  protected fn(el: HTMLButtonElement): void {
    const months = this._view === 'months';
    if (el === this.$prev) {
      if (months) this.stepYear(-1);
      else this.goto(this.monthIdx - 1, true, 'prev');
    } else if (el === this.$next) {
      if (months) this.stepYear(1);
      else this.goto(this.monthIdx + 1, true, 'next');
    } else if (el === this.$today) {
      const now = new Date();
      this.goto(now.getFullYear() * 12 + now.getMonth(), true, 'today');
      this.setView('days');
    }
  }

  protected jam(el: HTMLElement): void {
    el.classList.remove('jam');
    void el.offsetWidth;
    el.classList.add('jam');
    el.addEventListener('animationend', () => el.classList.remove('jam'), { once: true });
  }

  /** Escape on the month pad puts the body back (and goes no further, so a popup holding the calculator stays open). */
  protected onShellKey(e: KeyboardEvent): void {
    this.$shell.classList.remove('pointer');
    if (e.key === 'Escape' && this._view === 'months') {
      e.preventDefault();
      e.stopPropagation();
      this.setView('days');
      this.focus({ preventScroll: true });
    }
  }

  /** Space or Enter presses a key: it goes down, and comes up on keyup (Enter: a moment later). */
  protected pressKey(e: KeyboardEvent, el: HTMLButtonElement): void {
    e.preventDefault();
    if (e.repeat) return;
    if (el.classList.contains('off')) return this.jam(el);
    el.style.removeProperty('--rise');
    el.classList.add('down');
    if (e.key === 'Enter') setTimeout(() => this.keyUp(el), 110);
  }

  /** On the month pad: arrows move between the months, Page Up / Page Down turn the year, Enter / Space press. */
  protected onMonthKey(e: KeyboardEvent): void {
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

  protected onKeyUp(e: KeyboardEvent): void {
    if (e.key !== ' ') return;
    const el = (e.target as Element).closest<HTMLButtonElement>('.key');
    if (el?.classList.contains('down')) this.keyUp(el);
  }

  protected keyUp(el: HTMLButtonElement): void {
    el.classList.remove('down');
    this.release(el);
  }

  /** Two-finger sideways swipe on a trackpad turns the month (on the month pad, the year). */
  protected onWheel(e: WheelEvent): void {
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
      else this.goto(this.monthIdx + dir, true, 'swipe');
    }
  }
}
