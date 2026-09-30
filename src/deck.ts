import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';

/** 卡堆里每张卡露出来的偏移。 */
const STACK_DX = 1.2;
const STACK_DY = 3.2;
/** 划一下（只动一张）的动画时长，先加速再减速。 */
const STEP_MS = 720;
/** 卡堆按月分层能显示多远（离今天的月数），更远的月份压成最底下一层。 */
const HORIZON = 24;
/** 同时最多要露面的卡：左边卡堆最上面一张、三张摆开的、右边卡堆最上面一张。 */
const POOL_SIZE = 6;
const EPS = 1e-6;

/** 手指横向移动多少像素算一次划动；一次按下只算一划，划多长都一样。 */
const SWIPE_PX = 36;
/** 上一下刚停稳多久之内又朝同一方向划，也算"连续划"。 */
const GRACE_MS = 250;

/**
 * 转盘模式的物理参数（单位：月、秒）。每划一下给转盘加 impulse 的速度；
 * 阻尼让速度按 e^(-damping·t) 衰减，慢到 snapSpeed 以下，
 * 就用一个临界阻尼的弹簧把它吸到最近的月份上停住。
 */
const SPIN = {
  impulse: 5,
  maxSpeed: 14,
  damping: 4.5,
  snapSpeed: 1.8,
  spring: 16,
  /** 转起来时左右两边展开的速度。 */
  open: 12,
};

/** 先加速再减速。 */
const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** ease 的斜率：动画播到一半切进转盘模式时，接过当时的速度，不会顿一下。 */
const easeSlope = (t: number) => (t < 0.5 ? 12 * t * t : 3 * (2 - 2 * t) ** 2);
const lerp = (x: number, y: number, t: number) => x + (y - x) * t;

/**
 * 整条卡片流的状态。f 是摆在正中间的月份（月份序号 = 年 * 12 + 月），
 * 转动时是连续变化的小数；a / b 是左边 / 右边摆开的程度，0 收着，1 摆开。
 */
interface View {
  f: number;
  a: number;
  b: number;
}

/** 划一下：只动一张的那种动画。dir 是它朝哪边（收起 / 全摆开为 0）。 */
interface Tween {
  from: View;
  to: View;
  start: number;
  dir: 1 | -1 | 0;
}

/**
 * 转盘：v 是速度（月 / 秒），snap 是正在吸附的目标月份。
 * origin / count 记着这一串同方向的划动从哪个月开始、划了几下，
 * 停下时至少转过这么多个月——每划一下至少动一张。
 */
interface Spin {
  v: number;
  snap: number | null;
  dir: 1 | -1;
  origin: number;
  count: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthIndex = (y: number, m0: number) => y * 12 + m0;
const m0Of = (k: number) => ((k % 12) + 12) % 12;
const keyOf = (k: number) => `${Math.floor(k / 12)}-${pad2(m0Of(k) + 1)}`;
const parseKey = (s: string): number | null => {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  return m ? monthIndex(Number(m[1]), Math.min(11, Math.max(0, Number(m[2]) - 1))) : null;
};

/** 卡堆里的一层（一个月）：glow 表示这个月里有选中的日子，gap 是它和上一层之间的缝。 */
interface Layer {
  glow: boolean;
  gap: number;
}

const GLOW = 'color-mix(in srgb, var(--hc-ink, #ffd21f) 85%, transparent)';

/**
 * 画在卡片自己的阴影里的卡堆：下面按月一层层叠着，越往下越薄，跨年处多一道缝。
 * 有选中日子的那层边缘用荧光笔的颜色，并从缝里透出一圈光。side=1 往右下叠，-1 往左下叠。
 * selfGlow：这张卡自己压在别的卡下面、露出一条边时，也按它自己的月份发光。
 */
function stackShadow(layers: Layer[], side: 1 | -1, selfGlow = false): string {
  const parts = [`0 0 0 1px ${selfGlow ? GLOW : 'var(--hc-card-edge)'}`];
  // 自己压在别的卡下面时，光只从露出来的那条缝往卡堆那一侧透出来
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
  width: calc(3 * var(--hc-card-width) + 2 * var(--deck-gap));
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

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay'];

/**
 * <highlighter-deck>：像 iTunes 的 Cover Flow 一样的一条月份卡片流，最多同时摆开三个月。
 *
 * 平时只显示当前月，下面叠着今年剩下的月份。在空白处（日期格子以外的地方）：
 * - 划一下只动一张，不管在哪划、划多长：往右划，右边还收着就从卡堆里摆出下个月，
 *   摆开了就整排往后平移一格；往左划同理，上个月从屏幕外飞进来；
 * - 上一下还没停稳又朝同一方向接着划，就进入转盘模式：有阻尼的转动，
 *   每划一下加一把力，不再加力就很快停在某个月上；
 * - 点一下：收回成一叠，只留中间那个月。
 * 所有卡片共享同一份选择；属性和 input / change 事件与 <highlighter-calendar> 相同。
 */
export class HighlighterDeck extends HTMLElement {
  static observedAttributes = ['month', 'value', 'spread', ...FORWARDED];

  private $deck: HTMLElement;
  private pool: HighlighterCalendar[] = [];
  /** 每张卡现在显示的月份序号。 */
  private assigned = new Map<HighlighterCalendar, number>();
  private view: View;
  /** 上一次完全停稳时的状态，用来判断要不要发 monthchange / spreadchange。 */
  private settledView: View;
  private tween: Tween | null = null;
  private spin: Spin | null = null;
  /** 动画进行中收到的、要等停稳后再做的操作。 */
  private pending: 1 | -1 | 'collapse' | null = null;
  private lastStep = { end: -Infinity, dir: 0 };
  private raf = 0;
  private lastT = 0;
  private selection: string[] = [];
  /** 有选中日子的月份（月份序号），卡堆据此发光。 */
  private months = new Set<number>();
  private hinting = 0;
  private gesture: { id: number; x: number; y: number; t: number; fired: boolean } | null = null;
  private shadows = new Map<HighlighterCalendar, string>();
  private navShown: boolean | null = null;
  private ro: ResizeObserver | null = null;

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
    this.view = { f: monthIndex(now.getFullYear(), now.getMonth()), a: 0, b: 0 };
    this.settledView = { ...this.view };

    this.$deck.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$deck.addEventListener('pointermove', (e) => this.onMove(e));
    this.$deck.addEventListener('pointerup', (e) => this.onUp(e));
    this.$deck.addEventListener('pointercancel', () => (this.gesture = null));
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
    if (this.moving) {
      const f = this.tween?.to.f ?? this.spin?.snap ?? Math.round(this.view.f);
      this.jump(f);
    }
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    if (name === 'month') {
      const k = v ? parseKey(v) : null;
      if (k !== null) this.jump(k);
    } else if (name === 'value') {
      this.value = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (name === 'spread') {
      // 只作为初始状态：一开始就摆开三个月
      const on = v !== null ? 1 : 0;
      this.view = { ...this.view, a: on, b: on };
      this.settledView = { ...this.view };
      this.place();
    } else {
      for (const c of this.pool) {
        if (v === null) c.removeAttribute(name);
        else c.setAttribute(name, v);
      }
    }
  }

  // ---------- 公开 API ----------

  get value(): string[] {
    return [...this.selection];
  }

  set value(keys: string[]) {
    this.selection = [...new Set(keys)].sort();
    for (const c of this.pool) c.value = this.selection;
    this.selectionChanged();
  }

  /** 中间那张（收起时唯一那张）的月份，YYYY-MM；转动中是它将要停下的月份。 */
  get month(): string {
    return keyOf(Math.round(this.tween?.to.f ?? this.spin?.snap ?? this.view.f));
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  /** 是否摆开了（左右至少有一张）。设为 true 一次摆开三个月，false 收回成一叠。 */
  get spread(): boolean {
    if (this.spin) return true;
    const v = this.tween?.to ?? this.view;
    return v.a > 0 || v.b > 0;
  }

  set spread(on: boolean) {
    if (this.moving) {
      if (!on) this.pending = 'collapse';
      return;
    }
    const v = this.view;
    const t = on ? 1 : 0;
    if (v.a !== t || v.b !== t) this.tweenTo({ f: v.f, a: t, b: t }, 0);
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

  /** 等同于在空白处往右划一下。 */
  next(): void {
    this.swipe(1);
  }

  /** 等同于在空白处往左划一下。 */
  prev(): void {
    this.swipe(-1);
  }

  /** 直接摆到某个月并收成一叠，不播动画（日期框每次展开时用）。 */
  show(month: string): void {
    const k = parseKey(month);
    if (k === null) return;
    if (this.hinting) cancelAnimationFrame(this.hinting);
    this.hinting = 0;
    this.view = { f: k, a: 0, b: 0 };
    this.jump(k);
  }

  /** 收着的时候让右边卡堆最上面那张探出来抖两下，提示还能再摆出一个月。 */
  hint(): void {
    if (this.moving || this.hinting || this.view.a > 0 || this.view.b > 0) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (this.moving || t > 1.1) {
        this.hinting = 0;
        if (!this.moving) {
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

  // ---------- 划动与转动 ----------

  private get moving(): boolean {
    return this.tween !== null || this.spin !== null;
  }

  /**
   * 划一下：只动一张——这一边收着就摆出一张，摆开了就平移一格。
   * 上一下还没停稳又朝同一方向划，就进入转盘模式；转动中每划一下都给转盘加一把力，
   * 反方向划就是往回拨。
   */
  private swipe(dir: 1 | -1): void {
    if (this.hinting) {
      cancelAnimationFrame(this.hinting);
      this.hinting = 0;
      this.view = { ...this.view, b: 0 };
    }
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
    const v = this.view;
    if ((dir > 0 ? v.b : v.a) < 1) this.tweenTo(dir > 0 ? { ...v, b: 1 } : { ...v, a: 1 }, dir);
    else this.tweenTo({ f: v.f + dir, a: 1, b: 1 }, dir);
  }

  /** 点一下空白处：收回成一叠。转动中点一下就像按住转盘，就近停下再收。 */
  private tap(): void {
    if (this.spin) {
      this.spin.snap = Math.round(this.view.f);
      this.pending = 'collapse';
    } else if (this.tween) {
      this.pending = 'collapse';
    } else if (this.view.a > 0 || this.view.b > 0) {
      this.tweenTo({ ...this.view, a: 0, b: 0 }, 0);
    }
  }

  private jump(k: number): void {
    this.tween = null;
    this.spin = null;
    this.pending = null;
    this.$deck.classList.remove('busy');
    this.view = { f: k, a: Math.round(this.view.a), b: Math.round(this.view.b) };
    this.settledView = { ...this.view };
    this.assigned.clear();
    this.place();
  }

  private begin(): void {
    if (this.moving) return;
    this.$deck.classList.add('busy');
  }

  private tweenTo(to: View, dir: 1 | -1 | 0): void {
    this.begin();
    this.tween = { from: { ...this.view }, to, start: performance.now(), dir };
    this.kick();
  }

  private startSpin(dir: 1 | -1): void {
    let v = 0;
    let origin = Math.round(this.view.f);
    let count = 0;
    const tw = this.tween;
    if (tw) {
      // 从正在播放的这一下接过当时的速度；如果那一下是平移，它也算一张
      const p = Math.min(1, Math.max(0, (performance.now() - tw.start) / STEP_MS));
      v = ((tw.to.f - tw.from.f) * easeSlope(p)) / (STEP_MS / 1000);
      origin = tw.from.f;
      count = Math.abs(tw.to.f - tw.from.f);
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
      // 反方向拨：从现在的位置重新数
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
    if (this.spin) this.stepSpin(dt);
    else if (this.tween) this.stepTween(now);
    if (this.moving) this.kick();
    else this.lastT = 0;
  };

  private stepTween(now: number): void {
    const tw = this.tween!;
    const p = Math.min(1, Math.max(0, (now - tw.start) / STEP_MS));
    if (p >= 1) {
      this.view = { ...tw.to };
      this.tween = null;
      if (tw.dir) this.lastStep = { end: now, dir: tw.dir };
      this.settle();
      return;
    }
    const e = ease(p);
    this.view = { f: lerp(tw.from.f, tw.to.f, e), a: lerp(tw.from.a, tw.to.a, e), b: lerp(tw.from.b, tw.to.b, e) };
    this.place();
  }

  private stepSpin(dt: number): void {
    const s = this.spin!;
    let { f, a, b } = this.view;
    // 转起来的时候左右两边都摆开
    const k = 1 - Math.exp(-SPIN.open * dt);
    a = a + (1 - a) * k > 0.999 ? 1 : a + (1 - a) * k;
    b = b + (1 - b) * k > 0.999 ? 1 : b + (1 - b) * k;
    if (s.snap === null) {
      s.v *= Math.exp(-SPIN.damping * dt);
      f += s.v * dt;
      // 慢下来了：按这个速度本来会滑到哪，就停在离那最近的月份，但至少划几下就转过几个月
      if (Math.abs(s.v) < SPIN.snapSpeed) {
        const rest = Math.round(f + s.v / SPIN.damping);
        const least = s.origin + s.dir * s.count;
        s.snap = s.dir > 0 ? Math.max(rest, least) : Math.min(rest, least);
      }
    } else {
      const w = SPIN.spring;
      s.v += (-w * w * (f - s.snap) - 2 * w * s.v) * dt;
      f += s.v * dt;
    }
    this.view = { f, a, b };
    if (s.snap !== null && Math.abs(f - s.snap) < 0.002 && Math.abs(s.v) < 0.05 && a === 1 && b === 1) {
      this.view = { f: s.snap, a: 1, b: 1 };
      this.spin = null;
      this.lastStep = { end: performance.now(), dir: s.dir };
      this.settle();
      return;
    }
    this.place();
  }

  /** 一段动作停稳了：有排队的操作就接着做，否则真正静止下来并发事件。 */
  private settle(): void {
    const next = this.pending;
    this.pending = null;
    if (next === 'collapse' && (this.view.a > 0 || this.view.b > 0)) {
      this.place();
      this.tweenTo({ ...this.view, a: 0, b: 0 }, 0);
      return;
    }
    if (next === 1 || next === -1) {
      this.place();
      this.step(next);
      return;
    }
    this.$deck.classList.remove('busy');
    this.place();
    const from = this.settledView;
    this.settledView = { ...this.view };
    if (from.f !== this.view.f) this.emit('monthchange', { month: this.month });
    if (from.a !== this.view.a || from.b !== this.view.b) {
      this.emit('spreadchange', { spread: this.spread, left: this.view.a > 0, right: this.view.b > 0 });
    }
  }

  // ---------- 摆放 ----------

  private get cardWidth(): number {
    return this.pool[0].offsetWidth || 352;
  }

  /** 相邻两张卡之间的距离（一格）。 */
  private get pitch(): number {
    const gap = parseFloat(getComputedStyle(this).getPropertyValue('--deck-gap')) || 20;
    return this.cardWidth + gap;
  }

  private get todayIndex(): number {
    const now = new Date();
    return monthIndex(now.getFullYear(), now.getMonth());
  }

  /**
   * 月份 k 这张卡下面（side 方向）的卡堆：离今天 HORIZON 个月以内每个月一层，
   * 更远的月份压成最底下一层——哪怕转到很远，卡堆也不会无限变厚，远处有选中的日子照样发光。
   */
  private pile(k: number, side: 1 | -1): Layer[] {
    const limit = this.todayIndex + side * HORIZON;
    const layers: Layer[] = [];
    let i = 0;
    for (let m = k + side; side > 0 ? m <= limit : m >= limit; m += side) {
      const yearGap = m0Of(m) === (side > 0 ? 0 : 11) ? 1.8 : 0;
      layers.push({ glow: this.months.has(m), gap: Math.max(0.9, STACK_DY * 0.9 ** i) + yearGap });
      i++;
    }
    const edge = side > 0 ? Math.max(limit, k) : Math.min(limit, k);
    let far = false;
    for (const m of this.months) if (side > 0 ? m > edge : m < edge) far = true;
    layers.push({ glow: far, gap: 1.6 });
    return layers;
  }

  /**
   * 按当前状态（可以是转到一半）给每个要露面的月份分配一张卡并摆好：
   * 中间摆开的在桌面上；右边多出来的压在最右那张下面当卡堆；
   * 左边多出来的侧着身子飞向屏幕外。
   */
  private place(): void {
    if (!this.isConnected) return;
    const { f, a, b } = this.view;
    const step = this.pitch;
    const lo = Math.ceil(f - a - 1 - EPS);
    const hi = Math.floor(f + b + 1 + EPS);

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
        // 换月份前先摆平，日历才能按正常尺寸量格子、画笔迹
        el.style.transform = 'none';
        el.month = key;
      }
    }

    const rest = !this.moving;
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
        if (u < -a - EPS) {
          // 左边：压在最左那张下面的卡堆（过去的月份）；收起时看不见，摆开后才出现
          const d = u < -a - 1 - EPS ? 2 : -a - u;
          x = -a * step - d * STACK_DX;
          y = d * STACK_DY;
          if (d > 1 + EPS) opacity = 0;
          else {
            pileSide = -1;
            // 收着的时候，只有左边卡堆里有选过日子的月份（要发光提醒）才露出来
            const glowing = this.pile(k, -1).some((l) => l.glow) || this.months.has(k);
            opacity = glowing ? 1 : Math.min(1, Math.max(a, b) * 1.5);
          }
        } else if (u > b + EPS) {
          // 右边：压在最右那张下面的卡堆
          const d = u - b;
          x = b * step + d * STACK_DX;
          y = d * STACK_DY;
          if (d > 1 + EPS) opacity = 0;
          else pileSide = 1;
        } else {
          x = u * step;
          onTable = true;
        }
        // 离中间越远越靠下：两边的卡堆都压在桌面那几张下面
        el.style.zIndex = String(Math.round(100 - Math.abs(u) * 10));
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

    // 收起时中间那张可以用箭头翻月；摆开后改用左右划
    const nav = rest && a < 0.5 && b < 0.5;
    if (nav !== this.navShown) {
      this.navShown = nav;
      for (const el of this.pool) el.toggleAttribute('hide-nav', !nav);
    }
  }

  // ---------- 选择与手势 ----------

  private sync(from: HighlighterCalendar): void {
    this.selection = from.value;
    for (const c of this.pool) if (c !== from) c.value = this.selection;
    this.selectionChanged();
  }

  private selectionChanged(): void {
    this.months = new Set(this.selection.map((d) => monthIndex(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1)));
    if (!this.moving) this.place();
  }

  /** 卡片自己翻了月（收起时点箭头、键盘移出本月）：整条流跟着走。 */
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

  /** 空白处：日期格子和按钮以外的地方，卡片上、卡片之间、卡片旁边都算。 */
  private isBlank(e: Event): boolean {
    return !e
      .composedPath()
      .some((n) => n instanceof HTMLElement && (n.classList.contains('wrap') || n.localName === 'button'));
  }

  private onDown(e: PointerEvent): void {
    if ((e.pointerType === 'mouse' && e.button !== 0) || !this.isBlank(e)) return;
    this.gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, fired: false };
    try {
      this.$deck.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件没有真实指针，拿不到捕获也没关系
    }
  }

  private onMove(e: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId || g.fired) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    g.fired = true;
    this.swipe(dx > 0 ? 1 : -1);
  }

  private onUp(e: PointerEvent): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.id !== e.pointerId || g.fired) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 8 && e.timeStamp - g.t < 400) this.tap();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-deck': HighlighterDeck;
  }
  interface HTMLElementEventMap {
    spreadchange: CustomEvent<{ spread: boolean; left: boolean; right: boolean }>;
  }
}
