import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';

/** 卡堆里每张卡露出来的偏移。 */
const STACK_DX = 1.2;
const STACK_DY = 3.2;
/** 转一个月的时长；一次转过多个月时，每多一个月加一点。 */
const DURATION = 720;
const PER_EXTRA_MONTH = 240;
/** 甩一下最多转过几个月。 */
const MAX_SPIN = 6;
/** 飞出 / 飞进屏幕左边时侧过去的角度，有一点 Cover Flow 的味道。 */
const TILT = 48;
/** 同时最多要露面的卡：左边飞出去的一张、三张摆开的、右边卡堆最上面一张。 */
const POOL_SIZE = 6;
const EPS = 1e-6;

/** 先加速再减速。 */
const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
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

interface Tween {
  from: View;
  to: View;
  start: number;
  duration: number;
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
  width: calc(3 * var(--hc-card-width) + 2 * var(--deck-gap));
  max-width: 100%;
  margin: 0 auto;
  padding: 8px 0 56px;
  perspective: 1600px;
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
 * 平时只显示当前月，下面叠着今年剩下的月份。在卡片空白处：
 * - 往右划：下个月从卡堆里滑出来，摆到右边；往左划：上个月从屏幕外飞进来，摆到左边；
 * - 三个月摆满以后再划：整条流转动，最左那张飞出屏幕，最右那张沉回卡堆；甩得越快转过越多个月；
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
  private tween: Tween | null = null;
  private raf = 0;
  private xOff = -2000;
  private selection: string[] = [];
  private gesture: { id: number; x: number; y: number; t: number; trail: { x: number; t: number }[] } | null = null;
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
    if (this.tween) this.finish();
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
  }

  /** 中间那张（收起时唯一那张）的月份，YYYY-MM。 */
  get month(): string {
    return keyOf(Math.round((this.tween?.to ?? this.view).f));
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  /** 是否摆开了（左右至少有一张）。设为 true 一次摆开三个月，false 收回成一叠。 */
  get spread(): boolean {
    const v = this.tween?.to ?? this.view;
    return v.a > 0 || v.b > 0;
  }

  set spread(on: boolean) {
    if (this.tween) return;
    const v = this.view;
    const t = on ? 1 : 0;
    if (v.a !== t || v.b !== t) this.tweenTo({ f: v.f, a: t, b: t });
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

  /** 等同于在空白处往右划：右边还收着就摆出下个月，摆满了就往后转 months 个月。 */
  next(months = 1): void {
    this.go(1, months);
  }

  /** 等同于在空白处往左划：左边还收着就飞进上个月，摆满了就往前转 months 个月。 */
  prev(months = 1): void {
    this.go(-1, months);
  }

  // ---------- 转动 ----------

  private go(dir: 1 | -1, n: number): void {
    if (this.tween) return;
    const v = this.view;
    if ((dir > 0 ? v.b : v.a) < 1) {
      // 这一边还收着：只把这一边的一个月摆出来
      this.tweenTo(dir > 0 ? { ...v, b: 1 } : { ...v, a: 1 });
      return;
    }
    // 这一边已经摆开：整条流转动。另一边还收着的话，转一格正好摆满三个月
    const steps = (dir > 0 ? v.a : v.b) < 1 ? 1 : Math.max(1, Math.min(MAX_SPIN, n));
    this.tweenTo({ f: v.f + dir * steps, a: 1, b: 1 }, steps);
  }

  private jump(k: number): void {
    if (this.tween) this.finish();
    this.view = { ...this.view, f: k };
    this.assigned.clear();
    this.place();
  }

  private tweenTo(to: View, steps = 1): void {
    this.xOff = this.offscreenX();
    this.tween = {
      from: { ...this.view },
      to,
      start: performance.now(),
      duration: DURATION + (steps - 1) * PER_EXTRA_MONTH,
    };
    this.$deck.classList.add('busy');
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    this.raf = 0;
    const tw = this.tween;
    if (!tw) return;
    const p = Math.min(1, Math.max(0, (now - tw.start) / tw.duration));
    if (p >= 1) {
      this.finish();
      return;
    }
    const e = ease(p);
    this.view = { f: lerp(tw.from.f, tw.to.f, e), a: lerp(tw.from.a, tw.to.a, e), b: lerp(tw.from.b, tw.to.b, e) };
    this.place();
    this.raf = requestAnimationFrame(this.loop);
  };

  private finish(): void {
    const tw = this.tween!;
    this.view = { ...tw.to };
    this.tween = null;
    this.$deck.classList.remove('busy');
    this.place();
    if (tw.to.f !== tw.from.f) this.emit('monthchange', { month: this.month });
    if (tw.to.a !== tw.from.a || tw.to.b !== tw.from.b) {
      this.emit('spreadchange', { spread: this.spread, left: this.view.a > 0, right: this.view.b > 0 });
    }
  }

  // ---------- 摆放 ----------

  private get cardWidth(): number {
    return this.pool[0].offsetWidth || 352;
  }

  private get step(): number {
    const gap = parseFloat(getComputedStyle(this).getPropertyValue('--deck-gap')) || 20;
    return this.cardWidth + gap;
  }

  /** 屏幕左边外面：那个看不见的、反方向的卡堆。 */
  private offscreenX(): number {
    const r = this.$deck.getBoundingClientRect();
    const w = this.cardWidth;
    const cellLeft = r.left + (r.width - w) / 2;
    return Math.min(-(cellLeft + w + 60), -2 * this.step - 60);
  }

  /**
   * 按当前状态（可以是转到一半）给每个要露面的月份分配一张卡并摆好：
   * 中间摆开的在桌面上；右边多出来的压在最右那张下面当卡堆；
   * 左边多出来的侧着身子飞向屏幕外。
   */
  private place(): void {
    if (!this.isConnected) return;
    const { f, a, b } = this.view;
    const step = this.step;
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

    const rest = !this.tween;
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
        if (u < -a - EPS) {
          const d = Math.min(1, -a - u);
          x = lerp(u * step, this.xOff, d);
          y = d * STACK_DY;
          tilt = d * TILT;
          if (d >= 1 - EPS) opacity = 0;
        } else if (u > b + EPS) {
          const d = u - b;
          x = b * step + d * STACK_DX;
          y = d * STACK_DY;
          if (d > 1 + EPS) {
            opacity = 0;
          } else {
            pile = 11 - m0Of(k);
            // 新一年的 1 月：上一年 12 月下面本来没有卡堆，滑出来时才淡入
            if (m0Of(k) === 0) opacity = Math.min(1, Math.max(0, 1 - d));
          }
        } else {
          x = u * step;
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

    // 收起时中间那张可以用箭头翻月；摆开后改用左右划
    const nav = rest && a === 0 && b === 0;
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

  /** 卡片自己翻了月（收起时点箭头、键盘移出本月）：整条流跟着走。 */
  private onCardMonth(el: HighlighterCalendar): void {
    const k0 = this.assigned.get(el);
    const k1 = parseKey(el.month);
    if (this.tween || k0 === undefined || k1 === null || k0 === k1) return;
    this.view = { ...this.view, f: this.view.f + (k1 - k0) };
    this.assigned.clear();
    this.assigned.set(el, k1);
    this.place();
    this.emit('monthchange', { month: this.month });
  }

  private emit(type: 'monthchange' | 'spreadchange', detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** 卡片上的空白处：不在日期格子里、也不是按钮。 */
  private isBlank(e: Event): boolean {
    const path = e.composedPath() as Element[];
    if (!path.some((n) => n instanceof HTMLElement && n.localName === 'highlighter-calendar')) return false;
    return !path.some((n) => n instanceof HTMLElement && (n.classList.contains('wrap') || n.localName === 'button'));
  }

  private onDown(e: PointerEvent): void {
    if (this.tween || !this.isBlank(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, trail: [{ x: e.clientX, t: e.timeStamp }] };
    try {
      this.$deck.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件没有真实指针，拿不到捕获也没关系
    }
  }

  private onMove(e: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    g.trail.push({ x: e.clientX, t: e.timeStamp });
    if (g.trail.length > 24) g.trail.shift();
  }

  private onUp(e: PointerEvent): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) < 8 && e.timeStamp - g.t < 400) {
      // 点一下空白处：收回成一叠
      this.spread = false;
      return;
    }
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // 松手前一小段的速度：甩得越快、划得越远，转过的月份越多
    const recent = g.trail.find((p) => e.timeStamp - p.t <= 100) ?? g.trail[0];
    const v = Math.abs(e.clientX - recent.x) / Math.max(16, e.timeStamp - recent.t);
    const n = 1 + Math.floor(Math.max(0, Math.abs(dx) - 40) / this.step) + Math.floor(Math.max(0, v - 1.2) / 0.8);
    this.go(dx > 0 ? 1 : -1, n);
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
