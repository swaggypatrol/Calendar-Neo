import { DayRange, monthIndexOf } from './range';
import { DIGITS, SLOTS, displayChars, keyOf, monthSlots } from './keypad';
import { CAN_BEND, continuousRect, refractionMap } from './glass';

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

/** Weekdays as printed on a Japanese calendar, Sunday first. */
const KANJI_DAYS = ['日', '月', '火', '水', '木', '金', '土'];

const WORDS: Record<string, { today: string; prev: string; next: string; clear: string; none: string }> = {
  en: { today: 'Today', prev: 'Previous month', next: 'Next month', clear: 'Clear', none: 'No date chosen' },
  ja: { today: '今日', prev: '前の月', next: '次の月', clear: 'クリア', none: '日付が選ばれていません' },
  zh: { today: '今天', prev: '上个月', next: '下个月', clear: '清除', none: '尚未选择日期' },
};

/* ---------- Proportions: all from the golden ratio ---------- */

const PHI = (1 + Math.sqrt(5)) / 2;
/** A key's width, in % of the calculator's width: seven keys, six gaps of key/φ³ and two margins of key/φ fill it. */
const K = 100 / (7 + 6 / PHI ** 3 + 2 / PHI);
const cq = (n: number) => `${n.toFixed(3)}cqi`;
/** Key, gap between keys (key/φ³), margin (key/φ), spacing between parts (key/φ²), key travel. */
const U = { k: K, g: K / PHI ** 3, p: K / PHI, s: K / PHI ** 2 };
/** Corners: a key's radius is the gap; the body's sits concentric round it (radius + margin), the display's too. */
const R_KEY = U.g;
const R_BODY = R_KEY + U.p;

const STYLE = /* css */ `
:host {
  --rc-width: 23rem;
  display: inline-block;
  width: var(--rc-width);
  max-width: 100%;
  -webkit-tap-highlight-color: transparent;
  font-family: Inter, system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "PingFang SC", "Microsoft YaHei", sans-serif;

  /* The palette of the booking site it sits in: its yellow, its near-black ink, its cool greys */
  --brand: #facc15;
  --brand-deep: #f0b429;
  --ink: #020817;
  --muted: #64748b;
  --past: #94a3b8;
  /* Shu, the vermilion of seals and torii, for Sundays and today */
  --shu: #e0402a;
  --sat: #2563eb;
  --glass: rgba(255, 255, 255, 0.16);
  --glass-hi: rgba(255, 255, 255, 0.34);
  --key: rgba(255, 255, 255, 0.5);
  --key-hi: rgba(255, 255, 255, 0.92);
  --key-rim: rgba(255, 255, 255, 0.55);
  --shade: rgba(2, 8, 23, 0.2);
  --print: rgba(2, 8, 23, 0.62);
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --ink: #f8fafc;
    --muted: #94a3b8;
    --past: #64748b;
    --shu: #ff6a55;
    --sat: #6ea8ff;
    --glass: rgba(14, 16, 24, 0.3);
    --glass-hi: rgba(255, 255, 255, 0.12);
    --key: rgba(255, 255, 255, 0.11);
    --key-hi: rgba(255, 255, 255, 0.3);
    --key-rim: rgba(255, 255, 255, 0.22);
    --shade: rgba(0, 0, 0, 0.5);
    --print: rgba(248, 250, 252, 0.62);
  }
}
:host([theme="dark"]) {
  --ink: #f8fafc;
  --muted: #94a3b8;
  --past: #64748b;
  --shu: #ff6a55;
  --sat: #6ea8ff;
  --glass: rgba(14, 16, 24, 0.3);
  --glass-hi: rgba(255, 255, 255, 0.12);
  --key: rgba(255, 255, 255, 0.11);
  --key-hi: rgba(255, 255, 255, 0.3);
  --key-rim: rgba(255, 255, 255, 0.22);
  --shade: rgba(0, 0, 0, 0.5);
  --print: rgba(248, 250, 252, 0.62);
}

.frame {
  container-type: inline-size;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  color: var(--ink);
  --t: 0.9cqi;
}
/* The shadow the slab casts, drawn only outside it (the glass would otherwise show it through) */
.shade { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }

/* ---------- The body: a slab of clear liquid glass ---------- */
.shell {
  position: relative;
  padding: ${cq(U.p)};
  /* The rounded box clips the backdrop (which the path alone may not); the path then trims it to the continuous curve */
  border-radius: ${cq(R_BODY)};
  clip-path: var(--body-clip, inset(0 round ${cq(R_BODY)}));
  background:
    linear-gradient(155deg, var(--glass-hi), transparent 42%, transparent 70%, var(--glass-hi)),
    var(--glass);
  -webkit-backdrop-filter: blur(3px) saturate(1.7) brightness(1.04);
  backdrop-filter: blur(3px) saturate(1.7) brightness(1.04);
}
.shell.bend { backdrop-filter: url(#lg) saturate(1.7) brightness(1.04); }
.rim { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 3; }
.defs { position: absolute; width: 0; height: 0; }

/* ---------- Maker's mark: a seal and the name, a solar strip ---------- */
.mark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 ${cq(U.s)};
  color: var(--print);
  font-size: 2.5cqi;
  font-weight: 650;
  letter-spacing: 0.3em;
}
.mark > span { display: flex; align-items: center; gap: ${cq(U.g)}; }
.seal {
  display: grid;
  place-items: center;
  width: 4.6cqi;
  height: 4.6cqi;
  border-radius: 1cqi;
  background: var(--shu);
  color: #fff8f0;
  font-family: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Source Han Serif JP", "MS PMincho", serif;
  font-size: 3.2cqi;
  font-weight: 700;
  letter-spacing: 0;
  transform: rotate(-4deg);
  box-shadow: inset 0 0 0 0.35cqi rgba(255, 255, 255, 0.25);
}
.solar {
  display: flex;
  gap: 0.4cqi;
  padding: 0.5cqi;
  border-radius: 1.2cqi;
  background: rgba(20, 16, 10, 0.75);
  box-shadow: inset 0 0.25cqi 0.5cqi rgba(0, 0, 0, 0.6), 0 0 0 0.15cqi rgba(255, 255, 255, 0.3);
}
.solar i {
  width: 3.8cqi;
  height: 2.8cqi;
  border-radius: 0.35cqi;
  background: linear-gradient(160deg, #5a4630, #2a2116 55%, #1c160e);
}

/* ---------- The display: smoked glass over filament tubes ---------- */
.window {
  position: relative;
  padding: 3.6cqi 4cqi 2.4cqi;
  border-radius: ${cq(R_KEY)};
  clip-path: var(--win-clip, inset(0 round ${cq(R_KEY)}));
  background: radial-gradient(90% 130% at 50% 30%, rgba(26, 22, 10, 0.9), rgba(6, 6, 8, 0.94));
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  box-shadow: inset 0 0.8cqi 2cqi rgba(0, 0, 0, 0.85);
}
.window::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(168deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.03) 36%, transparent 36.5%);
}
.digits { display: block; width: 100%; height: auto; overflow: visible; }
.seg path { fill: none; stroke-linecap: round; }
.cold { stroke: #3f3410; stroke-width: 1.1; opacity: 0.8; }
.glow {
  stroke: #f5b800;
  stroke-width: 5.5;
  opacity: 0;
  /* A filament cools slower than it heats: the bloom lingers a moment after the core goes dark */
  transition: opacity 0.55s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.core {
  stroke: #fff6c8;
  stroke-width: 1.9;
  opacity: 0;
  transition: opacity 0.3s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.seg.on .glow { opacity: 0.9; transition: opacity 0.16s ease-in; }
.seg.on .core { opacity: 1; transition: opacity 0.1s ease-in; }
.seg.dim .glow { opacity: 0.35; transition: opacity 0.2s ease-in; }
.seg.dim .core { opacity: 0.45; transition: opacity 0.14s ease-in; }

.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-top: 2cqi;
  text-align: center;
  font-size: 2.6cqi;
  font-weight: 600;
}
.days span {
  color: rgba(250, 204, 21, 0.13);
  transition: color 0.5s cubic-bezier(0.2, 0.6, 0.3, 1), text-shadow 0.5s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.days span.on {
  color: #fff1b0;
  text-shadow: 0 0 0.6cqi #facc15, 0 0 1.8cqi rgba(245, 184, 0, 0.75);
  transition-duration: 0.14s;
}

/* ---------- Function row, with the month between ---------- */
.fn, .week, .pad {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: ${cq(U.g)};
}
.fn { align-items: center; margin: ${cq(U.p)} 0 ${cq(U.g)}; }
.month {
  grid-column: span 3;
  position: relative;
  overflow: hidden;
  height: ${cq(U.k * 0.809)};
}
.month > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1.6cqi;
  padding-top: 1.2cqi;
  white-space: nowrap;
}
.month b {
  font-family: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif CJK JP", "Source Han Serif JP", "MS PMincho", serif;
  font-size: ${cq(U.k / PHI)};
  font-weight: 600;
  letter-spacing: 0.02em;
}
.month small { color: var(--muted); font-size: 2.5cqi; font-weight: 600; letter-spacing: 0.14em; }
.week { margin: ${cq(U.s)} 0 ${cq(U.g)}; text-align: center; line-height: 1.15; }
.week span { display: grid; gap: 0.7cqi; color: var(--print); font-size: 3cqi; font-weight: 600; }
.week small { font-size: 1.8cqi; font-weight: 600; letter-spacing: 0.1em; opacity: 0.7; text-transform: uppercase; }
.week .sun { color: var(--shu); }
.week .sat { color: var(--sat); }

/* ---------- Keys: frosted liquid glass ---------- */
.slot { position: relative; }
/* The soft shadow each key casts on the glass behind it; it tightens as the key goes down */
.slot::before {
  content: "";
  position: absolute;
  inset: 14% 8% -6%;
  border-radius: 30%;
  background: var(--shade);
  filter: blur(1.1cqi);
  transform: translateY(0.9cqi);
  transition: transform 0.46s cubic-bezier(0.25, 1.75, 0.45, 1), opacity 0.46s ease;
  pointer-events: none;
}
.slot:has(.key.latched)::before { transform: translateY(0.35cqi); opacity: 0.75; transition-duration: 0.2s; }
.slot:has(.key.down)::before { transform: translateY(0.1cqi); opacity: 0.5; transition-duration: 0.075s; }
.slot:has(.key.blank)::before { opacity: 0; transition-duration: 0.32s; }
.key {
  appearance: none;
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1 / ${(PHI / 2).toFixed(3)};
  margin: 0;
  padding: 0;
  border: 0;
  font: inherit;
  color: var(--ink);
  cursor: pointer;
  touch-action: manipulation;
  outline: none;
  border-radius: ${cq(R_KEY)};
  clip-path: var(--key-clip, inset(0 round ${cq(R_KEY)}));
  background: radial-gradient(120% 95% at 28% 0%, var(--key-hi), transparent 58%), var(--key);
  -webkit-backdrop-filter: blur(9px) saturate(1.8);
  backdrop-filter: blur(9px) saturate(1.8);
  box-shadow:
    inset 0 0.35cqi 0.25cqi -0.05cqi var(--key-hi),
    inset 0 -0.5cqi 0.9cqi rgba(2, 8, 23, 0.07),
    inset 0 0 0 0.18cqi var(--key-rim);
  transform: translateY(0) scale(1);
  /* Coming back up is a spring: the interlock lets go and the key bounces a hair past its rest before settling */
  transition:
    transform 0.46s cubic-bezier(0.25, 1.75, 0.45, 1),
    box-shadow 0.46s ease,
    opacity 0.4s ease,
    color 0.3s ease;
}
.bend .key { backdrop-filter: url(#kg); }
/* Latched: down in the glass, filled with the brand's yellow from below */
.key::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 90% at 30% 0%, rgba(255, 255, 255, 0.55), transparent 55%),
    radial-gradient(90% 80% at 50% 110%, var(--brand-deep), transparent 70%),
    var(--brand);
  opacity: 0;
  transition: opacity 0.35s ease;
}
.key > * { position: relative; z-index: 1; }
.key.latched {
  transform: translateY(calc(var(--t) * 0.7)) scale(0.975);
  color: #1c1503;
  box-shadow:
    inset 0 0.5cqi 0.9cqi rgba(120, 80, 0, 0.35),
    inset 0 -0.3cqi 0.6cqi rgba(255, 255, 255, 0.35),
    inset 0 0 0 0.18cqi rgba(255, 255, 255, 0.4);
  transition:
    transform 0.2s cubic-bezier(0.2, 0.7, 0.3, 1),
    box-shadow 0.2s ease,
    opacity 0.4s ease,
    color 0.2s ease;
}
.key.latched::after { opacity: 0.92; transition-duration: 0.12s; }
.key.down {
  transform: translateY(var(--t)) scale(0.955);
  box-shadow:
    inset 0 0.6cqi 1cqi rgba(2, 8, 23, 0.18),
    inset 0 -0.2cqi 0.4cqi rgba(255, 255, 255, 0.2),
    inset 0 0 0 0.18cqi var(--key-rim);
  transition:
    transform 0.075s cubic-bezier(0.5, 0, 0.9, 0.5),
    box-shadow 0.075s ease,
    opacity 0.4s ease,
    color 0.2s ease;
}
/* A blank key: no day under it this month, so it sinks back into the glass */
.key.blank {
  transform: translateY(var(--t)) scale(0.9);
  opacity: 0.3;
  cursor: default;
  pointer-events: none;
  transition: transform 0.32s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.32s ease;
}
/* Out of range: the key is locked; it gives only a hair when pressed */
.key.off { cursor: not-allowed; }
.key.off .legend { opacity: 0.3; }
.key.jam { animation: jam 0.24s cubic-bezier(0.3, 0.7, 0.4, 1); }
@keyframes jam {
  35% { transform: translateY(calc(var(--t) * 0.25)); }
}
@media (hover: hover) {
  .key:not(.blank):not(.off):not(.down):not(.latched):hover { --key: var(--key-hover, rgba(255, 255, 255, 0.62)); }
}
.shell:not(.pointer) .key:focus-visible {
  box-shadow:
    inset 0 0.35cqi 0.25cqi -0.05cqi var(--key-hi),
    inset 0 0 0 0.55cqi var(--brand-deep);
}

.legend {
  font-size: ${cq(U.k / PHI ** 2)};
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 1;
  pointer-events: none;
}
.key.blank .legend, .key.blank .lamp { opacity: 0; }
.key.sun { color: var(--shu); }
.key.sat { color: var(--sat); }
.key.past { color: var(--past); }
.key.latched.sun, .key.latched.sat, .key.latched.past { color: #1c1503; }
/* Today: a vermilion dot under the number, like a seal's mark */
.key .lamp {
  position: absolute;
  bottom: 12%;
  left: 50%;
  width: 0.95cqi;
  height: 0.95cqi;
  margin-left: -0.475cqi;
  border-radius: 50%;
  background: var(--shu);
  opacity: 0;
  transition: opacity 0.4s ease;
}
.key.today .lamp { opacity: 1; }
.key.latched .lamp { background: #1c1503; }

.key.fnk .legend { font-size: 3cqi; font-weight: 650; letter-spacing: 0.02em; }
.key.today-key .legend { font-size: 2.5cqi; }
.key.today-key .legend:lang(ja), .key.today-key .legend:lang(zh) { font-size: 3cqi; }
.key.clear { color: var(--shu); }
.key svg { width: 3.4cqi; height: 3.4cqi; pointer-events: none; }
.key[disabled] { cursor: not-allowed; }
.key[disabled] .legend, .key[disabled] svg { opacity: 0.3; }

.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .key, .key.latched, .key.down, .key.blank { transition-duration: 0.12s; transition-timing-function: ease; }
}
`;

const CHEVRON = (dir: 'l' | 'r') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'l' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

/** The filters the glass bends light with; their maps are drawn once the sizes are known. */
const DEFS = `
<svg class="defs" aria-hidden="true">
  <filter id="lg" filterUnits="userSpaceOnUse" x="0" y="0" width="0" height="0" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" edgeMode="duplicate" result="soft"/>
    <feImage result="map" preserveAspectRatio="none" x="0" y="0" width="0" height="0"/>
    <feDisplacementMap in="soft" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="kg" filterUnits="userSpaceOnUse" x="0" y="0" width="0" height="0" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="7" edgeMode="duplicate" result="frost"/>
    <feImage result="map" preserveAspectRatio="none" x="0" y="0" width="0" height="0"/>
    <feDisplacementMap in="frost" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" result="bent"/>
    <feColorMatrix in="bent" type="saturate" values="1.8"/>
  </filter>
</svg>`;

const TEMPLATE = `
<style>${STYLE}</style>
<div class="frame">
  <svg class="shade" aria-hidden="true">
    <defs>
      <filter id="sb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
      <mask id="outside" maskUnits="userSpaceOnUse"><rect class="mrect" fill="#fff"/><path class="body" fill="#000"/></mask>
    </defs>
    <g mask="url(#outside)"><path class="body cast" fill="rgba(2, 8, 23, 0.32)" filter="url(#sb)"/></g>
  </svg>
  <div class="shell" part="shell">
    ${DEFS}
    <svg class="rim" aria-hidden="true">
      <defs>
        <linearGradient id="spec" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.95"/>
          <stop offset="0.3" stop-color="#fff" stop-opacity="0.25"/>
          <stop offset="0.7" stop-color="#fff" stop-opacity="0.08"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0.6"/>
        </linearGradient>
      </defs>
      <path class="body" fill="none" stroke="url(#spec)" stroke-width="3"/>
      <path class="body" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="14"/>
    </svg>
    <div class="mark" aria-hidden="true"><span><i class="seal">暦</i>CALENDAR NEO</span><span class="solar"><i></i><i></i><i></i><i></i></span></div>
    <div class="window" part="display" role="status" aria-live="polite">
      ${displaySvg()}
      <div class="days" aria-hidden="true"></div>
      <span class="sr readout"></span>
    </div>
    <div class="fn">
      <span class="slot"><button class="key fnk clear" type="button"><span class="legend">C</span></button></span>
      <span class="slot"><button class="key fnk prev" type="button">${CHEVRON('l')}</button></span>
      <div class="month" aria-live="polite"><span></span></div>
      <span class="slot"><button class="key fnk next" type="button">${CHEVRON('r')}</button></span>
      <span class="slot"><button class="key fnk today-key" type="button"><span class="legend"></span></button></span>
    </div>
    <div class="week" aria-hidden="true"></div>
    <div class="pad" role="radiogroup"></div>
  </div>
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
 * The body is a slab of liquid glass, the keys frosted glass, and the chosen date glows on a yellow filament display.
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
  private ro: ResizeObserver | null = null;
  private shapeSig = '';
  private $window: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$shell = q('.shell');
    this.$window = q('.window');
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
    this.ro ??= new ResizeObserver(() => this.shape());
    this.ro.observe(this.$shell);
  }

  disconnectedCallback(): void {
    this.ro?.disconnect();
  }

  /**
   * Cut the glass to size: the body, the display and every key get Apple's continuous corners, and where the browser
   * can bend light through a backdrop the body and the keys get their refraction maps. All keys share one size, so one
   * outline and one map serve them all.
   */
  private shape(): void {
    const W = this.$shell.offsetWidth;
    const H = this.$shell.offsetHeight;
    const key = this.$clear;
    const kw = key.offsetWidth;
    const kh = key.offsetHeight;
    const win = this.$window;
    const sig = [W, H, kw, kh, win.offsetWidth, win.offsetHeight].join();
    if (!W || !kw || sig === this.shapeSig) return;
    this.shapeSig = sig;
    const unit = W / 100;
    const rKey = R_KEY * unit;
    const rBody = R_BODY * unit;

    const body = continuousRect(W, H, rBody);
    this.style.setProperty('--body-clip', `path('${body}')`);
    this.style.setProperty('--key-clip', `path('${continuousRect(kw, kh, rKey)}')`);
    this.style.setProperty('--win-clip', `path('${continuousRect(win.offsetWidth, win.offsetHeight, rKey)}')`);

    const root = this.shadowRoot!;
    for (const svg of root.querySelectorAll<SVGSVGElement>('.shade, .rim')) {
      svg.setAttribute('width', String(W));
      svg.setAttribute('height', String(H));
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.style.overflow = svg.classList.contains('shade') ? 'visible' : 'hidden';
    }
    for (const path of root.querySelectorAll('path.body')) path.setAttribute('d', body);
    root.querySelector('.cast')!.setAttribute('transform', `translate(0 ${(unit * 3).toFixed(1)})`);
    const m = root.querySelector('.mrect')!;
    for (const [a, v] of [['x', -W], ['y', -H], ['width', W * 3], ['height', H * 3]] as const) m.setAttribute(a, String(v));
    const mask = root.querySelector('#outside')!;
    for (const [a, v] of [['x', -W], ['y', -H], ['width', W * 3], ['height', H * 3]] as const) mask.setAttribute(a, String(v));

    if (!CAN_BEND) return;
    this.lens('#lg', W, H, refractionMap(W, H, rBody, U.p * unit * 0.75), U.p * unit * 0.9);
    this.lens('#kg', kw, kh, refractionMap(kw, kh, rKey, Math.min(kw, kh) * 0.3), Math.min(kw, kh) * 0.28);
    this.$shell.classList.add('bend');
  }

  /** Size a refraction filter and give it its map; scale is the most it shifts the view, in px, either way. */
  private lens(id: string, w: number, h: number, map: string, shift: number): void {
    const f = this.shadowRoot!.querySelector(id)!;
    const img = f.querySelector('feImage')!;
    for (const el of [f, img]) {
      el.setAttribute('width', String(w));
      el.setAttribute('height', String(h));
    }
    img.setAttribute('href', map);
    f.querySelector('feDisplacementMap')!.setAttribute('scale', String(shift * 2));
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

  private language(): string {
    return (this.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase();
  }

  /** Japanese or Chinese readers already read 10月 and 日月火…; nobody else needs the gloss left out. */
  private cjk(): boolean {
    return /^(ja|zh)/.test(this.language());
  }

  private words() {
    return WORDS[this.language().slice(0, 2)] ?? WORDS.en;
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
    // Printed the Japanese way whatever the language: the month as 10月, in Mincho; the reader's own words small beside it
    const cjk = this.cjk();
    const aside = cjk ? `${y}` : new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'short' }).format(new Date(y, m0, 1)).toUpperCase();
    this.roll(this.$month, `<b>${m0 + 1}月</b><small>${aside}</small>`, dir);
    const wd = new Intl.DateTimeFormat(this.locale, { weekday: 'short' });
    const heads: string[] = [];
    const lamps: string[] = [];
    for (let i = 0; i < 7; i++) {
      const n = (this.weekStart + i) % 7;
      // 2023-01-01 was a Sunday
      const d = new Date(2023, 0, 1 + n);
      const cls = n === 0 ? 'sun' : n === 6 ? 'sat' : '';
      const sub = cjk ? '' : `<small>${wd.format(d).replace(/\.$/, '')}</small>`;
      heads.push(`<span class="${cls}">${KANJI_DAYS[n]}${sub}</span>`);
      lamps.push(`<span data-wd="${n}">${KANJI_DAYS[n]}</span>`);
    }
    this.$week.innerHTML = heads.join('');
    if (this.$days.dataset.sig !== lamps.join()) {
      this.$days.innerHTML = lamps.join('');
      this.$days.dataset.sig = lamps.join();
    }
    const todayLegend = this.$today.querySelector<HTMLElement>('.legend')!;
    todayLegend.textContent = w.today;
    todayLegend.lang = this.language().slice(0, 2);
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
  private roll(box: HTMLElement, html: string, dir: number): void {
    const cur = box.lastElementChild as HTMLElement;
    if (cur.dataset.html === html) return;
    if (!dir || !cur.dataset.html) {
      cur.innerHTML = html;
      cur.dataset.html = html;
      return;
    }
    const next = document.createElement('span');
    next.innerHTML = html;
    next.dataset.html = html;
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
