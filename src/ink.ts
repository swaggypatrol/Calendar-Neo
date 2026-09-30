/**
 * 画面层：把笔迹画成真实的荧光笔笔触。
 *
 * 选择逻辑（8x8 小格）在 engine.ts 里，这里只负责「看起来像荧光笔」：
 * - 笔头由几十根「刷毛」组成，边缘刷毛更淡、会随机断开，形成拉丝和渐变质感；
 * - 同一处画第二遍（来回画、或者停住不动）颜色会叠加变深，但有上限；
 * - 松手后，没被选中的日期上的墨迹淡出，选中日期的墨迹保留。
 */

import type { Tool } from './engine';

/** 每一遍笔触的不透明度；叠加 n 遍 ≈ 1 - (1 - PASS_ALPHA)^n。 */
export const PASS_ALPHA = 0.5;
/** 叠加变深的上限。 */
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
  /** 从起点算起的弧长 */
  s: number;
  /** 速度 px/ms */
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

let seedCounter = 1;

/** 一遍笔触：一串点 + 一把刷毛。 */
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

  /** 画到 ctx 上（颜色由调用方设好 strokeStyle）。upto 用于动画：只画到某个弧长。 */
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
        // 刚落笔：一个笔头形状的印子
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

  /** 边缘刷毛按噪声断开 → 拉丝；划得越快越干、断得越多。 */
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

/** 松笔后一段墨迹从原来的高度挪进窄带的动画（设备像素）。 */
interface Settle {
  slice: HTMLCanvasElement;
  /** 落定时在这条带子底下垫一笔（css 像素），把挪进来的笔画之间的空隙补齐。 */
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
  /** 深色背景上半透明的黄会发灰，打开后把墨色叠两次，显得更亮。 */
  boost = false;

  private dpr = 1;
  private pw = 1;
  private ph = 1;
  /** 已经落定的墨（单色，透明度累积）。 */
  private ink: HTMLCanvasElement;
  private scratch: HTMLCanvasElement;
  private comp: HTMLCanvasElement;
  private erase: HTMLCanvasElement;
  private mask: HTMLCanvasElement;
  /** 笔停住时洇出的墨，松手时才并入 ink（单击则丢弃）。 */
  private poolLayer: HTMLCanvasElement;
  private maskKey = '';
  private runs: Run[] = [];
  private pad = 4;
  /** 不能选的日期格：墨水不会留在上面（像涂在蜡纸上）。 */
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

  /** 改尺寸会清空墨迹，调用方随后要重新补画选中日期。 */
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

  /** 选中区域：同一行里连续选中的日期连成一段，墨迹只在这些区域里保留。 */
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

    // 来回画：方向掉头时把这一遍落定，新开一遍 → 重叠处颜色叠加变深
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

  /** 笔停住不动：墨水在笔尖下慢慢洇开、变深（有上限）。dt 毫秒。 */
  pool(x: number, y: number, dt: number): void {
    if (this.liveTool !== 'highlight') return;
    this.pooled += dt;
    // 攒够一点再画，避免每帧极小的透明度累加出条纹
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
    // 同心实色椭圆叠出柔和的墨团；不用渐变，避免抖动纹理被反复叠加放大
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

  /** 松手。commit=false 用于单击：不留落笔的印子，直接由补笔动画接手。 */
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
   * 自动补一笔：从 (x0,y0) 划到 (x1,y1)，带一点自然的弧度。
   * animate=true 时像有人拿笔划过去。
   */
  sweep(x0: number, y0: number, x1: number, y1: number, half: number, animate: boolean, delay = 0): void {
    const s = new BrushStroke(half);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = (Math.random() - 0.5) * half * 0.35;
    const n = Math.max(2, Math.ceil(len / 2));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      // 起笔慢、中间快、收笔慢 → 边缘拉丝的疏密也会跟着变
      s.add(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + Math.sin(Math.PI * u) * bow, i * (1 + 3 * Math.abs(u - 0.5)));
    }
    s.ended = true;
    if (animate) this.anims.push({ stroke: s, elapsed: -delay, duration: 160 + len * 2.2 });
    else this.commit(s);
  }

  /** 把选中区域以外的墨迹剪掉，并让它们淡出。 */
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
   * 松笔：每一段选中区域里的墨迹，按它实际涂到的上下范围，整体挪进这一行的窄带
   * （cy 为中心、上下各 half），笔触的拉丝和深浅都保留，只是位置和高度变整齐。
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
        // 已经在带子里了：只垫一笔补齐空隙
        this.underlay(r);
        continue;
      }
      const slice = layer(w, from[1] - from[0]);
      ctx2d(slice).drawImage(this.ink, x0, from[0], w, from[1] - from[0], 0, 0, w, from[1] - from[0]);
      c.clearRect(x0, from[0], w, from[1] - from[0]);
      this.settles.push({ slice, run: { left: r.left, right: r.right, cy: r.cy, half: r.half }, x: x0, from, to, elapsed: 0 });
    }
  }

  /** 还没播完的落带动画直接落定（新的一笔开始前）。 */
  private flushSettles(): void {
    for (const s of this.settles) this.land(s);
    this.settles = [];
  }

  /** 落定：挪好的笔画留在上面，底下垫一笔均匀的，整条带子看起来是一气呵成的。 */
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

  /** 画一帧，返回是否还需要继续动画。 */
  frame(dt: number): boolean {
    // 挪到位的先落进墨迹层（这一帧就能画出垫在底下的那一笔）
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
    // 松笔后的笔画正在挪进窄带：先快后慢，最后一点点落稳
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

    // 正在涂的时候所见即所得；其余时候只显示选中区域
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
    d.globalAlpha = MAX_DEPTH;
    d.drawImage(this.comp, 0, 0);
    if (this.boost) d.drawImage(this.comp, 0, 0);
    for (const g of this.ghosts) {
      d.globalAlpha = MAX_DEPTH * Math.max(0, g.alpha) ** 1.5;
      d.drawImage(g.canvas, 0, 0);
    }
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

  /** 把一笔落进墨迹层。under=true 时垫在已有墨迹的下面。 */
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
      // 左右两端做羽化，墨迹在日期边缘自然收住，而不是被一刀切齐
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
