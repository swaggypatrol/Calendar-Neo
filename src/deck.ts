import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';
import { DayRange } from './range';

/** 卡堆里每张卡露出来的偏移。 */
const STACK_DX = 1.2;
const STACK_DY = 3.2;
/** 程序调用 next() / prev() 时动一张的动画时长，先加速再减速。 */
const STEP_MS = 720;
/** 松手后卡片自己走完剩下那段路的最长 / 最短时间。 */
const RELEASE_MS = 480;
const RELEASE_MIN_MS = 160;
/** 飞出 / 飞进屏幕左边时侧过去的角度，有一点 Cover Flow 的味道。 */
const TILT = 48;
/** 同时最多要露面的卡：左边飞出去的一张、两张摆开的、右边卡堆最上面一张。 */
const POOL_SIZE = 5;
const EPS = 1e-6;

/** 手指横向移动多少像素开始算拖动。 */
const DRAG_PX = 6;
/** 卡片还在动时再划：横向移动多少像素算一次划动（用来加速转盘）。 */
const SWIPE_PX = 36;
/** 松手时拖过了这段路的多少就翻过去，否则弹回来。 */
const COMMIT = 0.3;
/** 松手时手指速度超过它（像素 / 毫秒）也算翻过去，轻轻一甩就行。 */
const FLICK_SPEED = 0.35;
/** 上一下刚停稳多久之内又朝同一方向划，也算"连续划"。 */
const GRACE_MS = 250;
/** 翻到可选范围的尽头：程序调用时整排挪一下再弹回；手指拖动时带阻尼跟手，松手弹回。 */
const BUMP_PX = 22;
const BUMP_MS = 380;
const RUBBER = 0.35;
const RUBBER_MAX = 70;

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
  /** 转起来时右边那张展开的速度。 */
  open: 12,
};

/** 先加速再减速。 */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** 只减速：松手时卡片已经跟着手指在动了，接着滑过去慢慢停下。 */
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** 缓动曲线的斜率：动画播到一半切进转盘模式时接过当时的速度，不会顿一下。 */
const slope = (e: (t: number) => number, t: number) => {
  const h = 1e-3;
  return (e(Math.min(1, t + h)) - e(Math.max(0, t - h))) / (Math.min(1, t + h) - Math.max(0, t - h));
};
const lerp = (x: number, y: number, t: number) => x + (y - x) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * 卡片流的状态。f 是桌面上最左边那张的月份（月份序号 = 年 * 12 + 月），
 * 转动时是连续变化的小数；b 是右边那张摆开的程度，0 只有一张，1 两张并排。
 */
interface View {
  f: number;
  b: number;
}

/** 从 from 动到 to。dir 是朝哪边翻（收起为 0）。 */
interface Tween {
  from: View;
  to: View;
  start: number;
  ms: number;
  ease: (t: number) => number;
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

/** 手指按在空白处。drag 是跟手拖动的状态：起点状态、要去的状态、这段路有多长。 */
interface Gesture {
  id: number;
  x: number;
  y: number;
  t: number;
  /** 'idle' 还没动；'drag' 卡片跟着手指走；'flick' 卡片正在动，这一下只用来加速；'scroll' 竖着划，不管。 */
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

/** 一张卡片下面叠着这一年剩下的月份：1 月下面 11 张，12 月就是最后一张。 */
function stackShadow(n: number): string {
  const parts = ['0 0 0 1px var(--hc-card-edge)'];
  for (let i = 1; i <= n; i++) {
    const dx = (i * STACK_DX).toFixed(1);
    const dy = (i * STACK_DY).toFixed(1);
    parts.push(`${dx}px ${dy}px 0 -1px var(--hc-card-bg)`, `${dx}px ${dy}px 0 0 var(--hc-card-edge)`);
  }
  parts.push(
    `${(n * STACK_DX + 2).toFixed(1)}px ${(n * STACK_DY + 8).toFixed(1)}px 22px rgba(0, 0, 0, 0.10)`,
    '0 1px 2px rgba(0, 0, 0, 0.06)',
  );
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
    --hc-card-bg: #1c1f24;
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
 * <highlighter-deck>：月份卡片流，同屏最多并排两个月，像在触屏上翻东西一样跟手。
 *
 * 平时只显示当前月，下面叠着今年剩下的月份。在空白处（日期格子以外的地方）按住横着拖：
 * - 手底下的卡片跟着手指走。往左拖，卡片往左滑开，下个月从卡堆里出来补上空出来的位置；
 *   往右拖，卡片往右滑开，上个月从屏幕左边外面滑进来；
 * - 一次拖动只翻一张。拖过一小段或轻轻一甩，松手就翻过去；否则弹回原位；
 * - 上一下还没停稳又朝同一方向划，就进入转盘模式：有阻尼的转动，每划一下加一把力；
 * - 点一下：收回成一张，留下点中的那个月。
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
  private pending: 1 | -1 | View | null = null;
  private lastStep = { end: -Infinity, dir: 0 };
  private raf = 0;
  private lastT = 0;
  private xOff = -2000;
  private selection: string[] = [];
  private gesture: Gesture | null = null;
  private shadows = new Map<HighlighterCalendar, string>();
  private navShown: boolean | null = null;
  private ro: ResizeObserver | null = null;
  /** 可选范围（min / max）：流转不到整月都不可选的月份。 */
  private range = new DayRange();
  /** 到头的回弹：wiggle 是程序调用时挪一下再回来，back 是拖动松手后从 from 像素弹回 0。 */
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
      // 只作为初始状态：一开始就并排两个月
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
        // 卡片已经各自去掉了范围外的选择
        this.selection = this.pool[0].value;
        this.jump(this.restingF);
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
  }

  /** 最左边那张（只有一张时就是它）的月份，YYYY-MM；转动中是它将要停下的月份。 */
  get month(): string {
    return keyOf(this.restingF);
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  /** 是否并排摆着两个月。设为 true 摆出下个月，false 收回成一张。 */
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
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value: [], added: [], removed: before },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** 翻到下个月，等同于在空白处往左拖一下。 */
  next(): void {
    this.swipe(1);
  }

  /** 翻到上个月，等同于在空白处往右拖一下。 */
  prev(): void {
    this.swipe(-1);
  }

  // ---------- 翻动与转动 ----------

  private get moving(): boolean {
    return this.tween !== null || this.spin !== null;
  }

  /** 现在（或动完以后）停在哪个月。 */
  private get restingF(): number {
    return Math.round(this.tween?.to.f ?? this.spin?.snap ?? this.view.f);
  }

  /**
   * 翻一张：dir=1 下个月（往左翻），-1 上个月（往右翻）。
   * 只有一张时，往左翻是把下个月摆到右边，往右翻是把上个月摆到左边；
   * 两张并排时整排平移一格。超出可选范围返回 null。
   */
  private stepTarget(from: View, dir: 1 | -1): View | null {
    const f = Math.round(from.f);
    const b = Math.round(from.b);
    const to = dir > 0 ? (b < 1 ? { f, b: 1 } : { f: f + 1, b: 1 }) : { f: f - 1, b: 1 };
    return this.inRange(to) ? to : null;
  }

  /** 这一步里手底下那张卡要走多远（像素）：并排 ↔ 一张 是半格，平移是一格。 */
  private travelOf(from: View, to: View): number {
    return Math.abs(to.f - from.f) >= 1 && Math.abs(to.b - from.b) < 0.5 ? this.pitch : this.pitch / 2;
  }

  /**
   * 程序翻一张（或卡片还在动时划了一下）：上一下还没停稳又朝同一方向划，就进入转盘模式；
   * 转动中每划一下都给转盘加一把力，反方向划就是往回拨。
   */
  private swipe(dir: 1 | -1): void {
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

  /** 到头了：整排朝手指会拖的方向挪一下再弹回来（往左拖是下个月）。 */
  private wiggle(dir: 1 | -1): void {
    this.bump = { kind: 'wiggle', from: -dir * BUMP_PX, start: performance.now() };
    this.kick();
  }

  /** 点一下空白处：收回成一张，留下点中的那个月。转动中点一下就像按住转盘，就近停下再收。 */
  private tap(e: PointerEvent): void {
    if (this.spin) {
      this.spin.snap = Math.min(this.fMax(1), Math.max(this.range.minMonth, Math.round(this.view.f)));
      this.pending = { f: this.spin.snap, b: 0 };
    } else if (this.tween) {
      this.pending = { f: this.tween.to.f, b: 0 };
    } else if (this.view.b > 0) {
      // 点在右边那张上就留右边那张，否则留左边
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

  /** 摆出来的每张卡（f 到 f+b）都在可选范围内。 */
  private inRange(v: View): boolean {
    this.range.refresh();
    return v.f >= this.range.minMonth - EPS && v.f + v.b <= this.range.maxMonth + EPS;
  }

  /** 把一个状态收进可选范围：左边那张不越界，右边越界就不摆开。 */
  private clampView(v: View): View {
    this.range.refresh();
    const { minMonth: lo, maxMonth: hi } = this.range;
    const f = Math.min(hi, Math.max(lo, v.f));
    return { f, b: Math.min(v.b, Math.max(0, hi - f)) };
  }

  /** 并排 b 张时最左那张最多能到哪个月。 */
  private fMax(b: number): number {
    const { minMonth: lo, maxMonth: hi } = this.range;
    return Math.max(lo, hi - b);
  }

  private begin(): void {
    if (this.moving) return;
    this.range.refresh();
    this.xOff = this.offscreenX();
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
      // 从正在播放的这一下接过当时的速度；如果那一下是平移，它也算一张
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
      // 慢下来了：按这个速度本来会滑到哪，就停在离那最近的月份，但至少划几下就转过几个月
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
    // 转到可选范围的尽头：撞墙停住
    if (f < lo || f > hi) {
      f = Math.min(hi, Math.max(lo, f));
      s.v = 0;
      s.snap = f;
    }
    // 转起来的时候两张并排；右边那张超出范围就不摆开
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

  /** 一段动作停稳了：有排队的操作就接着做，否则真正静止下来并发事件。 */
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

  // ---------- 摆放 ----------

  private get cardWidth(): number {
    return this.pool[0].offsetWidth || 352;
  }

  /** 相邻两张卡之间的距离（一格）。 */
  private get pitch(): number {
    const gap = parseFloat(getComputedStyle(this).getPropertyValue('--deck-gap')) || 20;
    return this.cardWidth + gap;
  }

  /** 屏幕左边外面：那个看不见的、反方向的卡堆。 */
  private offscreenX(): number {
    const r = this.$deck.getBoundingClientRect();
    const w = this.cardWidth;
    const cellLeft = r.left + (r.width - w) / 2;
    return Math.min(-(cellLeft + w + 60), -2 * this.pitch - 60);
  }

  /** 现在整排额外挪动的像素：拖到头时的阻尼跟手，或者松手 / 程序调用后的回弹。 */
  private nudge(): number {
    const g = this.gesture;
    if (g?.mode === 'drag' && !g.target) return g.rubber;
    const bp = this.bump;
    if (!bp) return 0;
    const p = clamp01((performance.now() - bp.start) / BUMP_MS);
    return bp.kind === 'back' ? bp.from * (1 - easeOut(p)) : bp.from * Math.sin(Math.PI * p) * (1 - p * 0.5);
  }

  /**
   * 按当前状态（可以是动到一半）给每个要露面的月份分配一张卡并摆好：
   * 并排的一两张在桌面上居中；右边多出来的压在最右那张下面当卡堆；
   * 左边多出来的侧着身子飞向屏幕外。
   */
  private place(): void {
    if (!this.isConnected) return;
    const { f, b } = this.view;
    const step = this.pitch;
    // 并排两张时整体往左挪半格，让两张一起居中
    const shift = (-b * step) / 2 + this.nudge();
    // 整月都不可选的月份不发卡
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
        // 换月份前先摆平，日历才能按正常尺寸量格子、画笔迹
        el.style.transform = 'none';
        el.month = key;
      }
    }

    const rest = !this.moving && this.gesture?.mode !== 'drag';
    for (const el of this.pool) {
      const k = this.assigned.get(el);
      let x = 0;
      let y = 0;
      let tilt = 0;
      let opacity = 1;
      let pile = 0;
      let onTable = false;
      if (k === undefined) {
        opacity = 0;
      } else {
        const u = k - f;
        if (u < -EPS) {
          const d = Math.min(1, -u);
          x = lerp(u * step + shift, this.xOff, d);
          y = d * STACK_DY;
          tilt = d * TILT;
          if (d >= 1 - EPS) opacity = 0;
        } else if (u > b + EPS) {
          const d = u - b;
          x = b * step + d * STACK_DX + shift;
          y = d * STACK_DY;
          if (d > 1 + EPS) {
            opacity = 0;
          } else {
            pile = Math.max(0, Math.min(11 - m0Of(k), this.range.maxMonth - k));
            // 新一年的 1 月：上一年 12 月下面本来没有卡堆，滑出来时才淡入
            if (m0Of(k) === 0) opacity = clamp01(1 - d);
          }
        } else {
          x = u * step + shift;
          onTable = true;
        }
        el.style.zIndex = String(Math.round(100 - u * 10));
      }
      el.style.transform = `translate(${x}px, ${y}px)${tilt ? ` rotateY(${tilt}deg)` : ''}`;
      el.style.opacity = opacity < 1 ? String(opacity) : '';
      el.classList.toggle('hidden', opacity <= 0);
      el.classList.toggle('inert', !onTable || !rest);
      const shadow = stackShadow(pile);
      if (this.shadows.get(el) !== shadow) {
        this.shadows.set(el, shadow);
        el.style.boxShadow = shadow;
      }
    }

    // 只有一张时可以用箭头翻月；并排后改用拖动
    const nav = rest && b === 0;
    if (nav !== this.navShown) {
      this.navShown = nav;
      for (const el of this.pool) el.toggleAttribute('hide-nav', !nav);
    }
  }

  // ---------- 选择与手势 ----------

  private sync(from: HighlighterCalendar): void {
    this.selection = from.value;
    for (const c of this.pool) if (c !== from) c.value = this.selection;
  }

  /** 卡片自己翻了月（只有一张时点箭头、键盘移出本月）：整条流跟着走。 */
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
    if (this.gesture || (e.pointerType === 'mouse' && e.button !== 0) || !this.isBlank(e)) return;
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
      // 合成事件没有真实指针，拿不到捕获也没关系
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

    // 跟手：往左拖是下个月，往右拖是上个月；拖回起点另一边就换方向
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
      // 拖到头了：松手弹回
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
