import { DayRange, monthIndexOf } from './range';
import { DIGITS, SLOTS, displayChars, keyOf, monthSlots } from './keypad';
import { roundedRect } from './g2';

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
  /* Everything is measured off the calculator's own width */
  container-type: inline-size;
  -webkit-tap-highlight-color: transparent;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "PingFang SC", "Microsoft YaHei", sans-serif;

  /* The house colours of a travel site in Japan: a warm sunflower yellow for what is chosen, the orange of its logo for
     the one key that undoes, near-black ink, and clear glass for everything else */
  --sunflower: #ffc915;
  --sunflower-deep: #f2ae00;
  --persimmon: #ee7d2b;
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
    0 0.6cqi 1.4cqi -0.4cqi var(--drop),
    0 5cqi 9cqi -3cqi var(--drop);
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

/* ---------- Top: a seal and the maker's mark, a strip of solar cells, then the display ---------- */
.mark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 calc(var(--g) * 1.618);
  color: var(--print);
  font-size: 2.5cqi;
  font-weight: 700;
  letter-spacing: 0.28em;
}
.mark > span:first-child { display: flex; align-items: center; gap: calc(var(--g) * 0.618); }
.mark small { font-weight: 500; letter-spacing: 0.12em; opacity: 0.8; }
/* A vermilion seal, the way a craftsman signs his work */
.seal {
  display: grid;
  place-items: center;
  width: 5.2cqi;
  height: 5.2cqi;
  border-radius: 1.2cqi;
  background: #c8372d;
  color: #fff4ea;
  font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Noto Serif JP", serif;
  font-size: 3.3cqi;
  font-weight: 700;
  letter-spacing: 0;
  box-shadow: inset 0 0 0 0.35cqi rgba(255, 244, 234, 0.85), inset 0 0 0 0.6cqi #c8372d;
}
.solar {
  display: flex;
  gap: 0.4cqi;
  padding: 0.5cqi;
  border-radius: 1.2cqi;
  background: rgba(30, 22, 16, 0.78);
  box-shadow: inset 0 0.3cqi 0.6cqi rgba(0, 0, 0, 0.6), 0 0.15cqi 0 rgba(255, 255, 255, 0.4);
}
.solar i {
  width: 4.2cqi;
  height: 3cqi;
  border-radius: 0.4cqi;
  background: linear-gradient(160deg, #6a4f3a, #3d2c22 55%, #2a1e17);
}

.window {
  position: relative;
  overflow: hidden;
  padding: 4cqi 4.5cqi 2.6cqi;
  border-radius: calc(var(--r) * 1.618);
  clip-path: var(--g2-win, none);
  background: radial-gradient(90% 120% at 50% 40%, #241d0c 0%, #130f06 60%, #0a0803 100%);
  box-shadow: inset 0 0.8cqi 2cqi rgba(0, 0, 0, 0.85);
}
/* The window's bevel, dark where it falls away from the light and catching it along the bottom; and the reflection on
   its glass */
.window::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--rim-win, none) no-repeat 0 0 / 100% 100%;
}
.window::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(168deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.03) 38%, transparent 38.5%),
    radial-gradient(60% 40% at 80% 110%, rgba(255, 255, 255, 0.05), transparent);
}
.digits { display: block; width: 100%; height: auto; overflow: visible; }
.seg path { fill: none; stroke-linecap: round; }
.cold { stroke: #3d3418; stroke-width: 1.1; opacity: 0.8; }
.glow {
  stroke: #ffbe0d;
  stroke-width: 5.5;
  opacity: 0;
  /* A filament cools slower than it heats: the bloom lingers a moment after the core goes dark */
  transition: opacity 0.55s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.core {
  stroke: #fff4c6;
  stroke-width: 1.9;
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.seg.on .glow { opacity: 0.85; transition: opacity 0.16s ease-in; }
.seg.on .core { opacity: 1; transition: opacity 0.1s ease-in; }
.seg.dim .glow { opacity: 0.32; transition: opacity 0.2s ease-in; }
.seg.dim .core { opacity: 0.42; transition: opacity 0.14s ease-in; }

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
  color: rgba(255, 200, 30, 0.13);
  transition: color 0.5s cubic-bezier(0.2, 0.6, 0.3, 1), text-shadow 0.5s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.days span.on {
  color: #ffe58a;
  text-shadow: 0 0 0.6cqi #ffbe0d, 0 0 1.8cqi rgba(255, 190, 13, 0.7);
  transition-duration: 0.14s;
}

/* ---------- The function row, with the month between, set in Mincho ---------- */
.fn {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
  align-items: center;
  margin: calc(var(--g) * 2.618) 0 calc(var(--g) * 0.618);
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
  font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Noto Serif JP", "Songti SC", serif;
  font-size: 3.9cqi;
  font-weight: 600;
  letter-spacing: 0.08em;
}
/* The days of the week in kanji, the way a Japanese calendar prints them: Sunday red, Saturday blue */
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
  margin: calc(var(--g) * 1.618) 0 calc(var(--g) * 0.618);
  text-align: center;
  color: var(--print);
  font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Noto Serif JP", serif;
  font-size: 2.9cqi;
  font-weight: 600;
}
.week .sun { color: var(--sun); }
.week .sat { color: var(--sat); }

/* ---------- Keys ---------- */
.pad {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
}
.slot {
  /* The groove in the glass the key rides in */
  padding: var(--lip) var(--lip) calc(var(--t) + var(--lip));
  border-radius: calc(var(--r) + var(--lip));
  background: var(--groove);
  box-shadow: inset 0 0.3cqi 0.7cqi rgba(0, 0, 0, 0.14), 0 0.15cqi 0 rgba(255, 255, 255, 0.3);
}
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
.shell:not(.pointer) .key:focus-visible::after {
  content: "";
  position: absolute;
  inset: calc(var(--lip) * -2.618);
  border-radius: calc(var(--r) + var(--lip) * 2.618);
  border: 0.45cqi solid var(--sunflower-deep);
  pointer-events: none;
}

.legend {
  position: relative;
  font-size: calc(var(--kw) * 0.382);
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 1;
  pointer-events: none;
  transition: color 0.3s ease;
}
.key.blank .legend, .key.blank .lamp { opacity: 0; }
.key.sun { color: var(--sun); }
.key.sat { color: var(--sat); }
.key.past { color: var(--muted); }
.key.latched.sun, .key.latched.sat, .key.latched.past { color: var(--ink); }
/* Today: a pinhead lamp under the number, lit the same yellow as the filaments */
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

/* Function keys, momentary (they always spring back): smoked glass for the arrows, the sunflower yellow for Today and
   the persimmon of the logo for C */
.key.fnk { --tint: var(--smoke-tint); --edge: rgba(0, 0, 0, 0.3); color: #f6f3ec; }
.key.go { --tint: linear-gradient(180deg, rgba(255, 214, 60, 0.95), rgba(255, 196, 10, 0.86)); --edge: rgba(190, 130, 0, 0.5); color: var(--ink); }
.key.hot { --tint: linear-gradient(180deg, rgba(246, 146, 70, 0.95), rgba(232, 110, 34, 0.86)); --edge: rgba(160, 70, 10, 0.5); color: #fffaf2; }
.key.fnk .legend, .key.hot .legend, .key.go .legend { font-size: 3cqi; font-weight: 700; letter-spacing: 0.04em; }
.key.go .legend.long { font-size: 2.4cqi; letter-spacing: 0; }
.key svg { position: relative; width: 3.4cqi; height: 3.4cqi; pointer-events: none; }
.key[disabled] { cursor: not-allowed; }
.key[disabled] .legend, .key[disabled] svg { opacity: 0.35; }

.lenses { position: absolute; width: 0; height: 0; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Until the exact continuous corners are drawn (and where they are not), the browser's own, where it has them */
@supports (corner-shape: squircle) {
  .shell, .glass, .window, .slot, .key, .face, .solar, .seal { corner-shape: squircle; }
  .shell { border-radius: calc((var(--r) + var(--lip) + var(--pad)) * 1.3); }
  .slot { border-radius: calc((var(--r) + var(--lip)) * 1.3); }
  .key { border-radius: calc(var(--r) * 1.3); }
}
@media (prefers-reduced-motion: reduce) {
  .key, .key.latched, .key.down, .key.blank, .key::before { transition-duration: 0.12s; transition-timing-function: ease; }
}
`;

const CHEVRON = (dir: 'l' | 'r') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'l' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

/** The days of the week as a Japanese calendar prints them, Sunday first. */
const KANJI = ['日', '月', '火', '水', '木', '金', '土'];

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

/** The bevel round the display window, sunk into the body: dark where it turns from the light, lit along the bottom. */
const bevel = (w: number, h: number, edge: string) =>
  svgUrl(
    w,
    h,
    `<defs><linearGradient id="l" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${h}">` +
      `<stop offset="0" stop-color="#000" stop-opacity=".7"/><stop offset=".6" stop-color="#000" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity=".28"/></linearGradient></defs>` +
      `<path d="${edge}" fill="none" stroke="url(#l)" stroke-width="3"/>`,
  );

/** How far in from its edge the glass is curved (and bends what is seen through it), and how far that bends it at most, as fractions of the key height. */
const KEY_BEZEL = 0.236;
const KEY_SHIFT = 0.236;
/** The same for the body, as fractions of its margin round the keys. */
const BODY_BEZEL = 1;
const BODY_SHIFT = 1;

const TEMPLATE = `
<style>${STYLE}</style>
<svg class="lenses" aria-hidden="true">${lensFilter('lens-body')}${lensFilter('lens-key')}</svg>
<div class="shell" part="shell">
  <div class="glass"></div>
  <div class="mark" aria-hidden="true"><span><span class="seal">暦</span>CALENDAR NEO <small>RC-8</small></span><span class="solar"><i></i><i></i><i></i><i></i></span></div>
  <div class="window" part="display" role="status" aria-live="polite">
    ${displaySvg()}
    <div class="days" aria-hidden="true"></div>
    <span class="sr readout"></span>
  </div>
  <div class="fn">
    <span class="slot"><button class="key hot clear" type="button"><span class="face"></span><span class="legend">C</span></button></span>
    <span class="slot"><button class="key fnk prev" type="button"><span class="face"></span>${CHEVRON('l')}</button></span>
    <div class="month" aria-live="polite"><span></span></div>
    <span class="slot"><button class="key fnk next" type="button"><span class="face"></span>${CHEVRON('r')}</button></span>
    <span class="slot"><button class="key go today-key" type="button"><span class="face"></span><span class="legend"></span></button></span>
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
 * The chosen date glows on a sunflower-yellow filament display. The body is liquid glass and the keys frosted glass, every
 * corner continuous (G2) and every proportion golden.
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
  private sizer?: ResizeObserver;
  /** The sizes the glass was last shaped for, to leave it be when nothing changed. */
  private glassSig = '';

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
      key.innerHTML = '<span class="face"></span><span class="legend"></span><span class="lamp"></span>';
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
    const heads: string[] = [];
    const lamps: string[] = [];
    for (let i = 0; i < 7; i++) {
      const n = (this.weekStart + i) % 7;
      // 2023-01-01 was a Sunday
      const d = new Date(2023, 0, 1 + n);
      const cls = n === 0 ? 'sun' : n === 6 ? 'sat' : '';
      heads.push(`<span class="${cls}">${KANJI[n]}</span>`);
      lamps.push(`<span data-wd="${n}">${wd.format(d).replace(/\.$/, '')}</span>`);
    }
    this.$week.innerHTML = heads.join('');
    if (this.$days.dataset.sig !== lamps.join()) {
      this.$days.innerHTML = lamps.join('');
      this.$days.dataset.sig = lamps.join();
    }
    const todayLegend = this.$today.querySelector('.legend')!;
    todayLegend.textContent = w.today;
    // A word like "Today" needs a smaller print than 今日 to fit the key
    todayLegend.classList.toggle('long', w.today.length > 2);
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

  /**
   * Cut the body, the keys and the display window to Apple's continuous corners at their real sizes, light their rims
   * along those edges, and (where the browser can) draw the maps that bend the view through the glass. Every key is the
   * same size, so one map serves them all.
   */
  private shapeGlass(): void {
    const key = this.keys[0];
    const slot = key.parentElement!;
    const win = this.$shell.querySelector<HTMLElement>('.window')!;
    const body = { w: this.$shell.offsetWidth, h: this.$shell.offsetHeight };
    const k = { w: key.offsetWidth, h: key.offsetHeight };
    const wn = { w: win.offsetWidth, h: win.offsetHeight };
    if (!body.w || !k.w) return;
    const sig = [body.w, body.h, k.w, k.h, wn.w, wn.h].join();
    if (sig === this.glassSig) return;
    this.glassSig = sig;

    // The radii as the stylesheet sets them: the key's 1/φ³ of its height, and each one further out concentric with it
    const pad = parseFloat(getComputedStyle(this.$shell).paddingTop);
    const lip = (slot.offsetWidth - k.w) / 2;
    const rKey = k.h * 0.236;
    const rBody = rKey + lip + pad;
    const rWin = rKey * 1.618;
    const keyEdge = roundedRect(k.w, k.h, rKey);
    const bodyEdge = roundedRect(body.w, body.h, rBody);
    const winEdge = roundedRect(wn.w, wn.h, rWin);
    const s = this.$shell.style;
    s.setProperty('--g2-key', `path('${keyEdge}')`);
    s.setProperty('--g2-body', `path('${bodyEdge}')`);
    s.setProperty('--g2-win', `path('${winEdge}')`);
    s.setProperty('--rim-key', rim(k.w, k.h, keyEdge));
    s.setProperty('--rim-body', rim(body.w, body.h, bodyEdge, 0.85));
    s.setProperty('--rim-win', bevel(wn.w, wn.h, winEdge));

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
    this.$shell.querySelector('.glass')!.classList.toggle('bend', bentBody);
    this.$shell.classList.toggle('bend', bentKeys);
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
