/**
 * Rendering layer: draws strokes as realistic highlighter marks.
 *
 * The selection logic (8x8 cells) lives in engine.ts; this file only makes it look like a highlighter:
 * - The tip is made of dozens of "bristles"; edge bristles are fainter and break up randomly, giving a streaky, graded texture;
 * - Going over the same spot again (back and forth, or holding still) darkens the colour, up to a cap;
 * - On release, ink on unselected days fades out while ink on selected days stays.
 */

import type { Tool } from './engine';

/** Opacity of a single pass; n overlapping passes ≈ 1 - (1 - PASS_ALPHA)^n. */
export const PASS_ALPHA = 0.5;
/** Upper limit for darkening from overlapping passes. */
export const MAX_DEPTH = 0.9;

export interface Run {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface InkPoint {
  x: number;
  y: number;
  /** Arc length from the start point */
  s: number;
  /** Speed in px/ms */
  v: number;
  t: number;
}

interface Bristle {
  off: number;
  w: number;
  a: number;
  edge: number;
  start: number;
  end: number;
  seed: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed) * (1 - u) + hash(i + 1 + seed) * u;
}

/** Any CSS colour as rgba() with the given alpha (via a scratch canvas, so names and hex both work). */
const colorCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
function rgba(color: string, a: number): string {
  if (!colorCtx) return color;
  colorCtx.fillStyle = '#000';
  colorCtx.fillStyle = color;
  const c = String(colorCtx.fillStyle);
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return c;
  const [r, g, b] = m[1].split(',').map((v) => v.trim());
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

let seedCounter = 1;

/** A single pass: a series of points plus a set of bristles. */
export class BrushStroke {
  readonly pts: InkPoint[] = [];
  ended = false;
  private bristles: Bristle[] = [];
  private dx: number;
  private dy: number;

  constructor(
    readonly half: number,
    seed = seedCounter++ * 7919,
    slant = -0.14,
  ) {
    this.dx = Math.sin(slant);
    this.dy = Math.cos(slant);
    const rnd = mulberry32(seed);
    const n = Math.max(16, Math.round(half * 1.6));
    const sp = (2 * half) / n;
    for (let b = 0; b < n; b++) {
      const u = ((b + 0.5) / n) * 2 - 1;
      const edge = Math.abs(u);
      this.bristles.push({
        off: u * half + (rnd() - 0.5) * sp * 0.6,
        w: sp * (1.5 + rnd() * 0.7) * (1 - edge * 0.3),
        a: (0.55 + 0.45 * (1 - edge ** 3)) * (0.82 + 0.18 * rnd()),
        edge,
        start: rnd() * half * 1.1 * edge ** 2,
        end: rnd() * half * 0.9 * edge ** 2,
        seed: Math.floor(rnd() * 1000),
      });
    }
  }

  get length(): number {
    return this.pts.length ? this.pts[this.pts.length - 1].s : 0;
  }

  add(x: number, y: number, t: number): void {
    const last = this.pts[this.pts.length - 1];
    if (!last) {
      this.pts.push({ x, y, s: 0, v: 0, t });
      return;
    }
    const ds = Math.hypot(x - last.x, y - last.y);
    if (ds < 0.75) return;
    const v = ds / Math.max(1, t - last.t);
    this.pts.push({ x, y, s: last.s + ds, v: last.v * 0.6 + v * 0.4, t });
  }

  /** Draw onto ctx (the caller sets strokeStyle). `upto` is for animation: draw only up to that arc length. */
  draw(ctx: CanvasRenderingContext2D, upto = Infinity): void {
    const pts = this.pts;
    if (!pts.length) return;
    const L = this.length;
    const lim = Math.min(upto, L);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const b of this.bristles) {
      const ox = b.off * this.dx;
      const oy = b.off * this.dy;
      ctx.globalAlpha = b.a;
      ctx.lineWidth = b.w;
      ctx.beginPath();
      if (L < 1) {
        // Pen just touched down: a tip-shaped imprint
        if (b.edge > 0.8 && hash(b.seed) > 0.5) continue;
        ctx.moveTo(pts[0].x + ox - 0.6, pts[0].y + oy);
        ctx.lineTo(pts[0].x + ox + 0.6, pts[0].y + oy);
        ctx.stroke();
        continue;
      }
      let pen = false;
      for (const p of pts) {
        if (p.s > lim) break;
        const vis = p.s >= b.start && (!this.ended || p.s <= L - b.end) && this.visible(b, p);
        const x = p.x + ox;
        const y = p.y + oy;
        if (vis) {
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = true;
        } else {
          pen = false;
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Edge bristles break up by noise → streaks; the faster the stroke, the drier it gets and the more it breaks. */
  private visible(b: Bristle, p: InkPoint): boolean {
    if (b.edge < 0.5) return true;
    const th = ((b.edge - 0.5) / 0.5) * 0.72 + Math.min(0.22, p.v * 0.1);
    return noise(p.s / 7 + b.seed, b.seed) > th;
  }
}

interface Anim {
  stroke: BrushStroke;
  elapsed: number;
  duration: number;
}

/** Animation that moves a stretch of ink from its original height into the narrow band after release (device pixels). */
interface Settle {
  slice: HTMLCanvasElement;
  /** When it lands, lay a stroke under this band (CSS pixels) to fill the gaps between the moved strokes. */
  run: { left: number; right: number; cy: number; half: number };
  x: number;
  from: [number, number];
  to: [number, number];
  elapsed: number;
}

const SETTLE_MS = 380;

interface Ghost {
  canvas: HTMLCanvasElement;
  alpha: number;
}

function layer(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d')!;
}

export class InkCanvas {
  color = '#ffd21f';
  /** Translucent yellow looks greyish on dark backgrounds; when on, the ink is composited twice to look brighter. */
  boost = false;

  private dpr = 1;
  private pw = 1;
  private ph = 1;
  /** Ink that has already been committed (single colour, accumulated alpha). */
  private ink: HTMLCanvasElement;
  private scratch: HTMLCanvasElement;
  private comp: HTMLCanvasElement;
  private erase: HTMLCanvasElement;
  private mask: HTMLCanvasElement;
  /** Ink pooled while the pen is held still; merged into `ink` on release (discarded on a tap). */
  private poolLayer: HTMLCanvasElement;
  private maskKey = '';
  private runs: Run[] = [];
  private pad = 4;
  /** Unselectable day cells: ink does not stick to them (like writing on wax paper). */
  private blocked: Run[] = [];

  private live: BrushStroke | null = null;
  private liveTool: Tool | null = null;
  private dirAnchor: { x: number; y: number } | null = null;
  private dir: { x: number; y: number } | null = null;
  private lastErase: { x: number; y: number } | null = null;
  private liveHalf = 10;
  private pooled = 0;
  private poolDrawn = 0;

  private anims: Anim[] = [];
  private ghosts: Ghost[] = [];
  private settles: Settle[] = [];

  constructor(private display: HTMLCanvasElement) {
    this.ink = layer(1, 1);
    this.scratch = layer(1, 1);
    this.comp = layer(1, 1);
    this.erase = layer(1, 1);
    this.mask = layer(1, 1);
    this.poolLayer = layer(1, 1);
  }

  get busy(): boolean {
    return this.live !== null || this.anims.length > 0 || this.ghosts.length > 0 || this.settles.length > 0;
  }

  /** Resizing clears the ink; the caller must then redraw the selected days. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    this.pw = Math.max(1, Math.round(cssW * dpr));
    this.ph = Math.max(1, Math.round(cssH * dpr));
    for (const c of [this.display, this.ink, this.scratch, this.comp, this.erase, this.mask, this.poolLayer]) {
      c.width = this.pw;
      c.height = this.ph;
    }
    this.maskKey = '';
    this.anims = [];
    this.ghosts = [];
    this.settles = [];
  }

  clear(): void {
    this.clearLayer(this.ink);
    this.anims = [];
    this.ghosts = [];
    this.settles = [];
  }

  setColor(color: string): void {
    this.color = color;
    const c = ctx2d(this.ink);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(0, 0, this.pw, this.ph);
    c.restore();
  }

  /** Selected regions: consecutive selected days in a row form one run; ink is kept only inside these regions. */
  setRuns(runs: Run[], pad: number): void {
    this.runs = runs;
    this.pad = pad;
  }

  setBlocked(rects: Run[]): void {
    this.blocked = rects;
  }

  beginLive(tool: Tool, x: number, y: number, t: number, half: number): void {
    this.flushSettles();
    this.liveTool = tool;
    this.liveHalf = half;
    this.pooled = 0;
    this.poolDrawn = 0;
    this.dir = null;
    this.dirAnchor = { x, y };
    if (tool === 'highlight') {
      this.live = new BrushStroke(half);
      this.live.add(x, y, t);
    } else {
      this.live = null;
      this.lastErase = { x, y };
      this.eraseSeg(x, y, x, y);
    }
  }

  liveTo(x: number, y: number, t: number): void {
    if (this.liveTool === 'erase') {
      const l = this.lastErase!;
      this.eraseSeg(l.x, l.y, x, y);
      this.lastErase = { x, y };
      return;
    }
    const pass = this.live;
    if (!pass) return;
    pass.add(x, y, t);
    this.pooled = 0;
    this.poolDrawn = 0;

    // Back-and-forth: when direction reverses, commit this pass and start a new one → overlaps get darker
    const a = this.dirAnchor!;
    const dist = Math.hypot(x - a.x, y - a.y);
    if (dist < 8) return;
    const d = { x: (x - a.x) / dist, y: (y - a.y) / dist };
    if (this.dir && d.x * this.dir.x + d.y * this.dir.y < -0.2 && pass.length > 14) {
      pass.ended = true;
      this.commit(pass);
      const next = new BrushStroke(this.liveHalf);
      next.add(a.x, a.y, t - 1);
      next.add(x, y, t);
      this.live = next;
    }
    this.dir = d;
    this.dirAnchor = { x, y };
  }

  /** Pen held still: ink slowly bleeds out and darkens under the tip (capped). `dt` in ms. */
  pool(x: number, y: number, dt: number): void {
    if (this.liveTool !== 'highlight') return;
    this.pooled += dt;
    // Accumulate a bit before drawing, so tiny per-frame alpha steps don't build up into banding
    if (this.pooled - this.poolDrawn < 60) return;
    const step = this.pooled - this.poolDrawn;
    this.poolDrawn = this.pooled;
    const half = this.liveHalf;
    const grow = 0.8 + Math.min(0.5, this.pooled / 2400);
    const c = ctx2d(this.poolLayer);
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.translate(x, y);
    c.rotate(0.14);
    c.scale(0.55, 1);
    // Stack concentric solid ellipses into a soft blot; no gradient, so dithering noise isn't amplified by repeated overlays
    const r = half * grow;
    c.fillStyle = this.color;
    const a = Math.min(0.2, step * 0.0012);
    for (const k of [1, 0.84, 0.68, 0.52, 0.36]) {
      c.globalAlpha = a * 0.45;
      c.beginPath();
      c.arc(0, 0, r * k, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /** Release. commit=false is for taps: leave no touch-down mark and let the fill-in animation take over. */
  endLive(commit = true): void {
    if (this.live && commit) {
      this.live.ended = true;
      this.commit(this.live);
      const c = ctx2d(this.ink);
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.poolLayer, 0, 0);
      c.restore();
    }
    this.clearLayer(this.poolLayer);
    this.live = null;
    this.liveTool = null;
    this.clearLayer(this.erase);
  }

  /**
   * Draw an automatic stroke from (x0,y0) to (x1,y1) with a slight natural curve.
   * With animate=true it looks like someone sweeping a pen across.
   */
  sweep(x0: number, y0: number, x1: number, y1: number, half: number, animate: boolean, delay = 0): void {
    const s = new BrushStroke(half);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = (Math.random() - 0.5) * half * 0.35;
    const n = Math.max(2, Math.ceil(len / 2));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      // Slow start, fast middle, slow finish → the density of the edge streaks varies accordingly
      s.add(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + Math.sin(Math.PI * u) * bow, i * (1 + 3 * Math.abs(u - 0.5)));
    }
    s.ended = true;
    if (animate) this.anims.push({ stroke: s, elapsed: -delay, duration: 160 + len * 2.2 });
    else this.commit(s);
  }

  /** Clip away ink outside the selected regions and fade it out. */
  prune(): void {
    this.buildMask();
    const ghost = layer(this.pw, this.ph);
    const g = ctx2d(ghost);
    g.drawImage(this.ink, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(this.mask, 0, 0);
    if (this.liveTool === 'erase') g.drawImage(this.erase, 0, 0);
    this.ghosts.push({ canvas: ghost, alpha: 1 });

    const c = ctx2d(this.ink);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(this.mask, 0, 0);
    c.restore();
  }

  /**
   * On release: take the ink in each selected run, using the vertical extent it actually
   * covered, and move it as a whole into the row's narrow band (centred on cy, `half` above
   * and below). Streaks and shading are preserved; only position and height get tidied up.
   */
  settle(rows: (Run & { cy: number; half: number })[]): void {
    this.flushSettles();
    const c = this.ink.getContext('2d', { willReadFrequently: true })!;
    for (const r of rows) {
      const d = this.dpr;
      const x0 = Math.max(0, Math.floor((r.left - this.pad) * d));
      const x1 = Math.min(this.pw, Math.ceil((r.right + this.pad) * d));
      const y0 = Math.max(0, Math.floor((r.top - this.pad) * d));
      const y1 = Math.min(this.ph, Math.ceil((r.bottom + this.pad) * d));
      if (x1 <= x0 || y1 <= y0) continue;
      const img = c.getImageData(x0, y0, x1 - x0, y1 - y0);
      const w = x1 - x0;
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < y1 - y0; y++) {
        let hit = false;
        for (let x = 0; x < w; x += 2) {
          if (img.data[(y * w + x) * 4 + 3] > 28) {
            hit = true;
            break;
          }
        }
        if (hit) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
      if (top < 0) continue;
      const from: [number, number] = [y0 + top, y0 + bottom + 1];
      const to: [number, number] = [(r.cy - r.half) * d, (r.cy + r.half) * d];
      if (Math.abs(from[0] - to[0]) < 1.5 * d && Math.abs(from[1] - to[1]) < 1.5 * d) {
        // Already inside the band: just lay an underlay stroke to fill the gaps
        this.underlay(r);
        continue;
      }
      const slice = layer(w, from[1] - from[0]);
      ctx2d(slice).drawImage(this.ink, x0, from[0], w, from[1] - from[0], 0, 0, w, from[1] - from[0]);
      c.clearRect(x0, from[0], w, from[1] - from[0]);
      this.settles.push({ slice, run: { left: r.left, right: r.right, cy: r.cy, half: r.half }, x: x0, from, to, elapsed: 0 });
    }
  }

  /** Immediately land any settle animations still in progress (before a new stroke starts). */
  private flushSettles(): void {
    for (const s of this.settles) this.land(s);
    this.settles = [];
  }

  /** Land: the moved strokes stay on top with an even stroke underneath, so the whole band looks like one continuous mark. */
  private land(st: Settle): void {
    const c = ctx2d(this.ink);
    c.drawImage(st.slice, st.x, st.to[0], st.slice.width, st.to[1] - st.to[0]);
    this.underlay(st.run);
  }

  private underlay(run: { left: number; right: number; cy: number; half: number }): void {
    const { left, right, cy, half } = run;
    const s = new BrushStroke(half);
    const n = Math.max(2, Math.ceil((right - left + 6) / 2));
    for (let i = 0; i <= n; i++) s.add(left - 3 + ((right - left + 6) * i) / n, cy + (0.5 - i / n) * half * 0.12, i);
    s.ended = true;
    this.commit(s, true);
  }

  /** Draw one frame; returns whether the animation needs to continue. */
  frame(dt: number): boolean {
    // Land finished settles into the ink layer first (so this frame already shows the underlay stroke)
    for (const st of this.settles) st.elapsed += dt;
    for (const st of this.settles.filter((x) => x.elapsed >= SETTLE_MS)) this.land(st);
    this.settles = this.settles.filter((x) => x.elapsed < SETTLE_MS);
    for (const a of this.anims) a.elapsed += dt;
    const done = this.anims.filter((a) => a.elapsed >= a.duration);
    this.anims = this.anims.filter((a) => a.elapsed < a.duration);
    for (const a of done) this.commit(a.stroke);
    for (const g of this.ghosts) g.alpha -= dt / 320;
    this.ghosts = this.ghosts.filter((g) => g.alpha > 0);

    const comp = ctx2d(this.comp);
    comp.setTransform(1, 0, 0, 1, 0, 0);
    comp.globalCompositeOperation = 'source-over';
    comp.globalAlpha = 1;
    comp.clearRect(0, 0, this.pw, this.ph);
    comp.drawImage(this.ink, 0, 0);
    if (this.liveTool === 'highlight') comp.drawImage(this.poolLayer, 0, 0);
    // Strokes moving into the narrow band after release: fast at first, then easing gently into place
    for (const st of this.settles) {
      const e = 1 - (1 - Math.min(1, st.elapsed / SETTLE_MS)) ** 3;
      const top = st.from[0] + (st.to[0] - st.from[0]) * e;
      const bottom = st.from[1] + (st.to[1] - st.from[1]) * e;
      comp.drawImage(st.slice, st.x, top, st.slice.width, bottom - top);
    }

    if (this.live || this.anims.length) {
      this.clearLayer(this.scratch);
      const s = ctx2d(this.scratch);
      s.save();
      s.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      s.strokeStyle = this.color;
      this.live?.draw(s);
      for (const a of this.anims) {
        if (a.elapsed <= 0) continue;
        const u = Math.min(1, a.elapsed / a.duration);
        const e = 1 - (1 - u) ** 3;
        a.stroke.draw(s, a.stroke.length * e);
      }
      s.restore();
      comp.globalAlpha = PASS_ALPHA;
      comp.drawImage(this.scratch, 0, 0);
      comp.globalAlpha = 1;
    }

    // While highlighting, show exactly what is drawn; otherwise show only the selected regions
    if (this.liveTool !== 'highlight') {
      this.buildMask();
      comp.globalCompositeOperation = 'destination-in';
      comp.drawImage(this.mask, 0, 0);
    }
    if (this.liveTool === 'erase') {
      comp.globalCompositeOperation = 'destination-out';
      comp.drawImage(this.erase, 0, 0);
    }
    comp.globalCompositeOperation = 'source-over';

    const d = ctx2d(this.display);
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.clearRect(0, 0, this.pw, this.ph);
    this.drawInk(d, this.comp, 1);
    for (const g of this.ghosts) this.drawInk(d, g.canvas, Math.max(0, g.alpha) ** 1.5);
    d.globalAlpha = 1;
    if (this.blocked.length) {
      d.save();
      d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      d.globalCompositeOperation = 'destination-out';
      d.beginPath();
      for (const r of this.blocked) d.roundRect(r.left, r.top, r.right - r.left, r.bottom - r.top, 8);
      d.fill();
      d.restore();
    }
    return this.busy;
  }

  /** Commit a stroke into the ink layer. With under=true it goes beneath the existing ink. */
  /**
   * Put an ink layer on screen. On light paper it is simply translucent. On dark paper (boost) it is drawn
   * like real fluorescent ink: a soft bloom of light spilling around the strokes, the ink itself, then a
   * screen-blended pass that makes the colour look lit from within, and a faint white-hot core.
   */
  private drawInk(d: CanvasRenderingContext2D, src: HTMLCanvasElement, fade: number): void {
    if (fade <= 0) return;
    if (!this.boost) {
      d.globalAlpha = MAX_DEPTH * fade;
      d.drawImage(src, 0, 0);
      return;
    }
    const k = this.dpr;
    d.save();
    // Bloom: the glow around the strokes, wide and soft, then a tighter halo
    d.shadowColor = rgba(this.color, 0.55 * fade);
    d.shadowBlur = 22 * k;
    d.globalAlpha = 0.9 * fade;
    d.drawImage(src, 0, 0);
    d.shadowColor = rgba(this.color, 0.7 * fade);
    d.shadowBlur = 7 * k;
    d.drawImage(src, 0, 0);
    d.shadowBlur = 0;
    d.shadowColor = 'transparent';
    // Luminous body: screen-blending the ink over itself lifts it towards light instead of making it muddy
    d.globalCompositeOperation = 'screen';
    d.globalAlpha = 0.65 * fade;
    d.drawImage(src, 0, 0);
    // White-hot core where the ink is densest
    d.globalCompositeOperation = 'lighter';
    d.globalAlpha = 0.12 * fade;
    d.drawImage(src, 0, 0);
    d.restore();
  }

  private commit(stroke: BrushStroke, under = false): void {
    this.clearLayer(this.scratch);
    const s = ctx2d(this.scratch);
    s.save();
    s.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    s.strokeStyle = this.color;
    stroke.draw(s);
    s.restore();
    const c = ctx2d(this.ink);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = PASS_ALPHA;
    if (under) c.globalCompositeOperation = 'destination-over';
    c.drawImage(this.scratch, 0, 0);
    c.restore();
  }

  private eraseSeg(x0: number, y0: number, x1: number, y1: number): void {
    const c = ctx2d(this.erase);
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#000';
    const h = this.liveHalf * 1.05;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      c.beginPath();
      c.ellipse(x, y, h * 0.5, h, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  private buildMask(): void {
    const key = this.runs.map((r) => `${r.left},${r.right},${r.top}`).join('|') + `/${this.pad}`;
    if (key === this.maskKey) return;
    this.maskKey = key;
    this.clearLayer(this.mask);
    const c = ctx2d(this.mask);
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const p = this.pad;
    for (const r of this.runs) {
      // Feather the left and right ends so ink fades out naturally at the day edges instead of being cut off sharply
      const x0 = r.left - p;
      const x1 = r.right + p;
      const g = c.createLinearGradient(x0, 0, x1, 0);
      const f = Math.min(0.45, (p + 3) / (x1 - x0));
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(f, '#000');
      g.addColorStop(1 - f, '#000');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x0, r.top - p, x1 - x0, r.bottom - r.top + 2 * p);
    }
    c.restore();
  }

  private clearLayer(l: HTMLCanvasElement): void {
    const c = ctx2d(l);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, l.width, l.height);
    c.restore();
  }
}
