import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';
import { DayRange } from './range';

/** 翻一页的时长；连着翻（点书签、快速划）时每页更快。 */
const FLIP_MS = 680;
const RIFFLE_MS = 300;
/** 松手时翻过了多少就翻过去，否则落回原处；甩得够快也算。 */
const COMMIT = 0.3;
const FLICK_SPEED = 0.35;
/** 手指横向移动多少像素开始算拖动。 */
const DRAG_PX = 6;
/** 书口两侧显示页边的最远范围（离今天的月数）。 */
const HORIZON = 24;

/** 页角被掀起时往上（或往下）拱起的高度，占页高的比例。 */
const LIFT = 0.22;

interface Pt {
  x: number;
  y: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);

/** 用一条直线把多边形切开，留下 keep(点) >= 0 的那一半。 */
function clipPoly(poly: Pt[], side: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

const polyCss = (pts: Pt[]) =>
  pts.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${pts.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(', ')})`;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthIndex = (y: number, m0: number) => y * 12 + m0;
const m0Of = (k: number) => ((k % 12) + 12) % 12;
const keyOf = (k: number) => `${Math.floor(k / 12)}-${pad2(m0Of(k) + 1)}`;
const parseKey = (s: string): number | null => {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  return m ? monthIndex(Number(m[1]), Math.min(11, Math.max(0, Number(m[2]) - 1))) : null;
};

const STYLE = /* css */ `
:host {
  --hb-paper: #fbf8f2;
  --hb-paper-edge: #e9e3d6;
  --hb-line: rgba(60, 45, 25, 0.07);
  --hb-shadow: rgba(40, 30, 15, 0.18);
  --hb-ink: #ffd21f;
  --hc-card-width: 22rem;
  display: block;
}
@media (prefers-color-scheme: dark) {
  :host {
    --hb-paper: #2f3238;
    --hb-paper-edge: #45484f;
    --hb-line: rgba(255, 255, 255, 0.07);
    --hb-shadow: rgba(0, 0, 0, 0.45);
  }
}
.book {
  position: relative;
  width: max-content;
  margin: 0 auto;
  padding: 10px 40px 30px;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.spread {
  position: relative;
  display: grid;
  grid-template-columns: auto auto;
}
.page, .turn {
  position: relative;
  box-sizing: border-box;
  padding: 16px 18px 14px;
  background:
    radial-gradient(120% 90% at 50% 40%, transparent 60%, rgba(120, 90, 40, 0.05)),
    var(--hb-paper);
}
.shape-l { border-radius: 10px 2px 2px 10px; }
.shape-r { border-radius: 2px 10px 10px 2px; }
.page.left { box-shadow: var(--edges-left, none), -6px 14px 28px -10px var(--hb-shadow); }
.page.right { box-shadow: var(--edges-right, none), 6px 14px 28px -10px var(--hb-shadow); }
/* 中缝：靠近装订处的阴影 */
.gutter {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
}
.shape-l .gutter { background: linear-gradient(to left, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.04) 5%, transparent 14%); }
.shape-r .gutter { background: linear-gradient(to right, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.04) 5%, transparent 14%); }
/* 翻页时的光影：沿折线的一条渐变。页面上是被掀起的纸投下的影子，纸上是折起来的弧面的明暗 */
.fx {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
}
.strip {
  position: absolute;
  left: 0;
  top: 0;
  width: 4000px;
  transform-origin: 0 0;
  visibility: hidden;
}
/* 翻着的那张纸：正面留在原处、沿折线裁掉折起来的部分；背面按折线镜像过去盖在上面 */
.turn {
  position: absolute;
  top: 0;
  visibility: hidden;
  transform-origin: 0 0;
}
.flip-on .turn { visibility: visible; }
.flap {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  filter: drop-shadow(0 0 7px rgba(0, 0, 0, 0.22));
}
.turn.front { z-index: 4; }
.pool {
  position: absolute;
  left: -10000px;
  top: 0;
  visibility: hidden;
}
highlighter-calendar {
  display: block;
  width: var(--hc-card-width);
  --hc-bg: transparent;
  --hc-line: var(--hb-line);
}
/* 书口的折角：鼠标移上去翘起来，点一下翻页 */
.corner {
  position: absolute;
  bottom: 30px;
  width: 30px;
  height: 30px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  z-index: 6;
}
.corner::before {
  content: '';
  position: absolute;
  bottom: 0;
  width: 14px;
  height: 14px;
  transition: width 0.18s, height 0.18s;
  box-shadow: -2px -2px 5px rgba(0, 0, 0, 0.12);
}
.corner.next { right: 40px; }
.corner.next::before { right: 0; background: linear-gradient(135deg, var(--hb-paper-edge) 50%, transparent 50%); border-radius: 0 0 10px 0; }
.corner.prev { left: 40px; }
.corner.prev::before { left: 0; background: linear-gradient(225deg, var(--hb-paper-edge) 50%, transparent 50%); border-radius: 0 0 0 10px; box-shadow: 2px -2px 5px rgba(0, 0, 0, 0.12); }
.corner:hover::before { width: 24px; height: 24px; }
.corner[disabled] { visibility: hidden; }
/* 书签：有选择的月份那张纸从书口伸出一枚 */
.tabs {
  position: absolute;
  top: 10px;
  bottom: 30px;
  width: 30px;
  pointer-events: none;
}
.tabs.left { right: calc(100% - 40px); }
.tabs.right { left: calc(100% - 40px); }
/* 书签有一半夹在纸下面，只露出带字的一截 */
.tabs.right .tab { text-align: right; }
.tabs.left .tab { text-align: left; }
.tab {
  position: absolute;
  width: 30px;
  border: 0;
  padding: 0 4px;
  font: 600 10px/1 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #3a2f12;
  white-space: nowrap;
  background: color-mix(in srgb, var(--hb-ink) 88%, #ffffff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  pointer-events: auto;
  transition: transform 0.15s;
}
.tabs.right .tab { left: 0; border-radius: 0 6px 6px 0; }
.tabs.left .tab { right: 0; border-radius: 6px 0 0 6px; }
.tabs.right .tab:hover { transform: translateX(3px); }
/* 正在看的月份：书签夹在这一页里，从页顶垂下来，尾巴剪成燕尾 */
.ribbon {
  position: absolute;
  top: -5px;
  width: 20px;
  height: 50px;
  box-sizing: border-box;
  padding-top: 26px;
  text-align: center;
  font: 700 10px/1 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #3a2f12;
  background: color-mix(in srgb, var(--hb-ink) 88%, #ffffff);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%);
  pointer-events: none;
  z-index: 2;
}
.page.left .ribbon { left: 24px; }
.page.right .ribbon { right: 24px; }
.tabs.left .tab:hover { transform: translateX(-3px); }
`;

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay', 'min', 'max'];

/**
 * 一次翻页。几何都在"镜像坐标"里算：原点在中缝顶端，翻着的那页总是在右边 x∈[0,W]；
 * 往前翻（dir=-1）时整个左右镜像一下。corner 是被掀起的页角，P 是页角现在被拉到的位置，
 * 纸沿 C、P 连线的垂直平分线折过去。
 */
interface Flip {
  dir: 1 | -1;
  top: boolean;
  P: Pt;
  anim: { from: Pt; to: Pt; start: number; ms: number; ease: (t: number) => number; lift: number } | null;
}

/**
 * <highlighter-book>：一本打开的纸质日历。左右两页，每张纸正反两面都印着月份，
 * 所以任何时候都同时摊开两个月；沿中缝翻页，有翻页效果。
 *
 * - 在日期格子以外的空白处按住往左拖，右页跟着手指翻过去；往右拖，左页翻回来。
 *   拖过一小段或轻轻一甩就翻过去，否则落回原处。连着快速划会一页接一页地翻。
 * - 点页角的折角也能翻页。
 * - 有选中日子的月份，那张纸在书口伸出一枚书签（按月份排在书口不同高度），点书签直接翻到那个月。
 * - 已经过去的月份印着一圈暗角。
 * 属性和 input / change 事件与 <highlighter-calendar> 相同；另有 month（左页的月份）、next() / prev()。
 */
export class HighlighterBook extends HTMLElement {
  static observedAttributes = ['month', 'value', ...FORWARDED];

  private $book: HTMLElement;
  private $left: HTMLElement;
  private $right: HTMLElement;
  private $spread: HTMLElement;
  private $front: HTMLElement;
  private $back: HTMLElement;
  private $pool: HTMLElement;
  private $tabsL: HTMLElement;
  private $tabsR: HTMLElement;
  private $prev: HTMLButtonElement;
  private $next: HTMLButtonElement;
  private pages: HighlighterCalendar[] = [];
  /** 左页的月份（月份序号 = 年 * 12 + 月）。右页是 m + 1。 */
  private m: number;
  private flip: Flip | null = null;
  /** 翻页过程中收到的后续翻页。 */
  private queue: (1 | -1)[] = [];
  private raf = 0;
  private hintRaf = 0;
  private selection: string[] = [];
  private range = new DayRange();
  private gesture: {
    id: number;
    x: number;
    y: number;
    t: number;
    mode: 'idle' | 'drag' | 'flick' | 'scroll';
    samples: { t: number; x: number }[];
  } | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="book" part="book">
        <div class="tabs left"></div>
        <div class="spread">
          <div class="page left shape-l"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div>
          <div class="page right shape-r"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div>
          <div class="turn front"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div>
          <div class="flap"><div class="turn back"><div class="slot"></div><div class="gutter"></div><div class="fx"><div class="strip"></div></div></div></div>
        </div>
        <div class="tabs right"></div>
        <button class="corner prev" type="button" aria-label="上一页"></button>
        <button class="corner next" type="button" aria-label="下一页"></button>
        <div class="pool" aria-hidden="true"></div>
      </div>`;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$book = q('.book');
    this.$left = q('.page.left');
    this.$right = q('.page.right');
    this.$spread = q('.spread');
    this.$front = q('.turn.front');
    this.$back = q('.turn.back');
    this.$pool = q('.pool');
    this.$tabsL = q('.tabs.left');
    this.$tabsR = q('.tabs.right');
    this.$prev = q('.corner.prev');
    this.$next = q('.corner.next');

    for (let i = 0; i < 4; i++) {
      const c = document.createElement('highlighter-calendar');
      c.setAttribute('hide-nav', '');
      c.addEventListener('input', () => this.sync(c));
      c.addEventListener('change', () => this.sync(c));
      c.addEventListener('monthchange', (e) => {
        e.stopPropagation();
        this.onPageMonth(c);
      });
      this.pages.push(c);
      this.$pool.append(c);
    }
    const now = new Date();
    this.m = monthIndex(now.getFullYear(), now.getMonth());
    this.holder(this.$left).append(this.pages[0]);
    this.holder(this.$right).append(this.pages[1]);

    this.$prev.addEventListener('click', () => this.prev());
    this.$next.addEventListener('click', () => this.next());
    this.$book.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$book.addEventListener('pointermove', (e) => this.onMove(e));
    this.$book.addEventListener('pointerup', (e) => this.onUp(e, false));
    this.$book.addEventListener('pointercancel', (e) => this.onUp(e, true));
  }

  connectedCallback(): void {
    this.layout();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.flip) this.finishFlip(this.progress(this.flip) >= 0.5);
    this.queue = [];
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    if (name === 'month') {
      if (v) this.show(v);
    } else if (name === 'value') {
      this.value = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      for (const c of this.pages) {
        if (v === null) c.removeAttribute(name);
        else c.setAttribute(name, v);
      }
      if (name === 'color') this.style.setProperty('--hb-ink', v ?? '#ffd21f');
      if (name === 'min' || name === 'max') {
        this.range.set(name, v);
        this.selection = this.pages[0].value;
        this.selectionChanged();
        this.show(keyOf(this.m));
      }
    }
  }

  // ---------- 公开 API ----------

  get value(): string[] {
    return [...this.selection];
  }

  set value(keys: string[]) {
    this.selection = [...new Set(keys)].sort();
    for (const c of this.pages) c.value = this.selection;
    this.selectionChanged();
  }

  /** 左页的月份，YYYY-MM。 */
  get month(): string {
    return keyOf(this.m);
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  get tool(): Tool {
    return this.pages[0].tool;
  }

  set tool(t: Tool) {
    for (const c of this.pages) c.tool = t;
  }

  get color(): string {
    return this.pages[0].color;
  }

  set color(v: string) {
    this.style.setProperty('--hb-ink', v);
    for (const c of this.pages) c.color = v;
  }

  get threshold(): number {
    return this.pages[0].threshold;
  }

  set threshold(n: number) {
    for (const c of this.pages) c.threshold = n;
  }

  clear(): void {
    const before = this.selection;
    if (!before.length) return;
    this.selection = [];
    for (const c of this.pages) c.clear(true);
    this.selectionChanged();
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: [], added: [], removed: before }, bubbles: true, composed: true }),
    );
  }

  /** 往后翻一页（右页翻到左边）。 */
  next(): void {
    this.request(1);
  }

  /** 往前翻一页（左页翻回右边）。 */
  prev(): void {
    this.request(-1);
  }

  /** 直接摊开到某个月在左页，不播动画。 */
  show(month: string): void {
    const k = parseKey(month);
    if (k === null) return;
    this.stopHint();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.flip) this.finishFlip(false);
    this.queue = [];
    this.m = this.clampLeft(k);
    this.layout();
  }

  /** 右页的页角翘起来抖两下，提示可以翻页。 */
  hint(): void {
    if (this.flip || this.gesture || this.hintRaf || !this.canFlip(1)) return;
    this.beginFlip(1, false);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (!this.flip || this.gesture || t > 1.1) {
        this.hintRaf = 0;
        if (this.flip && !this.flip.anim) this.finishFlip(false);
        return;
      }
      // 页角翘起来一点再落下，像被风掀了两下
      const k = Math.abs(Math.sin((t * Math.PI) / 0.34)) * Math.exp(-t * 2.4);
      const C = this.corner(this.flip);
      this.flip.P = { x: C.x - 46 * k, y: C.y - 30 * k };
      this.render();
      this.hintRaf = requestAnimationFrame(tick);
    };
    this.hintRaf = requestAnimationFrame(tick);
  }

  // ---------- 翻页 ----------

  private holder(el: HTMLElement): HTMLElement {
    return el.querySelector('.slot') as HTMLElement;
  }

  private get todayIndex(): number {
    const now = new Date();
    return monthIndex(now.getFullYear(), now.getMonth());
  }

  /** 左页最早、最晚能是哪个月（两页里至少有一页在可选范围内）。 */
  private clampLeft(k: number): number {
    this.range.refresh();
    return Math.min(this.range.maxMonth, Math.max(this.range.minMonth - 1, k));
  }

  private canFlip(dir: 1 | -1): boolean {
    this.range.refresh();
    return dir > 0 ? this.m + 2 <= this.range.maxMonth : this.m + 1 - 2 >= this.range.minMonth;
  }

  private stopHint(): void {
    if (!this.hintRaf) return;
    cancelAnimationFrame(this.hintRaf);
    this.hintRaf = 0;
    if (this.flip && !this.flip.anim) this.finishFlip(false);
  }

  private request(dir: 1 | -1, fast = false): void {
    this.stopHint();
    if (this.flip) {
      this.queue.push(dir);
      return;
    }
    if (!this.canFlip(dir)) return;
    this.beginFlip(dir, false);
    this.animateTo(true, fast ? RIFFLE_MS : FLIP_MS, fast ? easeOut : easeInOut);
  }

  /** 把一页（日历元素）设成某个月；已经是这个月就不动它（保留手画的笔迹）。 */
  private setMonth(el: HighlighterCalendar, k: number): void {
    const key = keyOf(k);
    if (el.month !== key) el.month = key;
    el.toggleAttribute('vignette', k < this.todayIndex);
  }

  private spare(): HighlighterCalendar[] {
    return this.pages.filter((c) => c.parentElement === this.$pool);
  }

  /**
   * 开始翻一页。往后翻：右页那张纸（这面 m+1、另一面 m+2）从页角掀起往左翻，下面露出 m+3；
   * 往前翻：左页那张纸（这面 m、另一面 m-1）翻回右边，左边露出 m-2。
   */
  private beginFlip(dir: 1 | -1, top = false): void {
    // 页上夹着的书签先收起来，翻完再按新的两页放
    for (const r of this.shadowRoot!.querySelectorAll('.ribbon')) r.remove();
    const W = this.$right.offsetWidth;
    const H = this.$right.offsetHeight;
    for (const el of [this.$front, this.$back]) {
      el.style.width = `${W}px`;
      el.style.height = `${H}px`;
      el.style.transform = 'none';
      el.style.clipPath = '';
    }
    // 正面在它原来那页的位置；背面按对面那页的样子排好，翻的时候再镜像过去
    const [fl, bl] = dir > 0 ? [W, 0] : [0, W];
    this.$front.style.left = `${fl}px`;
    this.$back.style.left = `${bl}px`;
    this.$front.className = `turn front ${dir > 0 ? 'shape-r' : 'shape-l'}`;
    this.$back.className = `turn back ${dir > 0 ? 'shape-l' : 'shape-r'}`;
    const left = this.holder(this.$left).firstElementChild as HighlighterCalendar;
    const right = this.holder(this.$right).firstElementChild as HighlighterCalendar;
    const [a, b] = this.spare();
    if (dir > 0) {
      this.setMonth(a, this.m + 2);
      this.setMonth(b, this.m + 3);
      this.holder(this.$front).append(right);
      this.holder(this.$back).append(a);
      this.holder(this.$right).append(b);
    } else {
      this.setMonth(a, this.m - 1);
      this.setMonth(b, this.m - 2);
      // 往前翻：留在原处的是左页（m），折过去露出来的是它的另一面（m-1）
      this.holder(this.$front).append(left);
      this.holder(this.$back).append(a);
      this.holder(this.$left).append(b);
    }
    this.flip = { dir, top, P: { x: W, y: top ? 0 : H }, anim: null };
    this.flip.P = this.corner(this.flip);
    this.$spread.classList.add('flip-on');
    this.$book.classList.add('busy');
    this.render();
  }

  /** 翻完（done=true）或者落回原处。 */
  private finishFlip(done: boolean): void {
    const f = this.flip;
    if (!f) return;
    const front = this.holder(this.$front).firstElementChild as HighlighterCalendar;
    const back = this.holder(this.$back).firstElementChild as HighlighterCalendar;
    if (f.dir > 0) {
      if (done) {
        const oldLeft = this.holder(this.$left).firstElementChild as HighlighterCalendar;
        this.holder(this.$left).append(back);
        this.$pool.append(oldLeft, front);
        this.m += 2;
      } else {
        const under = this.holder(this.$right).firstElementChild as HighlighterCalendar;
        this.holder(this.$right).append(front);
        this.$pool.append(under, back);
      }
    } else {
      if (done) {
        const oldRight = this.holder(this.$right).firstElementChild as HighlighterCalendar;
        this.holder(this.$right).append(back);
        this.$pool.append(oldRight, front);
        this.m -= 2;
      } else {
        const under = this.holder(this.$left).firstElementChild as HighlighterCalendar;
        this.holder(this.$left).append(front);
        this.$pool.append(under, back);
      }
    }
    this.flip = null;
    this.$spread.classList.remove('flip-on');
    this.$book.classList.remove('busy');
    for (const s of this.shadowRoot!.querySelectorAll<HTMLElement>('.strip')) s.style.visibility = 'hidden';
    this.layout();
    if (done) this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  /** 页宽、页高。 */
  private get size(): { W: number; H: number } {
    return { W: this.$right.offsetWidth || 1, H: this.$right.offsetHeight || 1 };
  }

  /** 被掀起的页角（镜像坐标）。 */
  private corner(f: Flip): Pt {
    const { W, H } = this.size;
    return { x: W, y: f.top ? 0 : H };
  }

  /** 翻过去的程度 0..1：页角从原位（x=W）走到对面（x=-W）。 */
  private progress(f: Flip): number {
    const { W } = this.size;
    return clamp01((W - f.P.x) / (2 * W));
  }

  /**
   * 页角不能被拉得离书脊太远（纸是连在书脊上的）：离同侧书脊端点不超过页宽，
   * 离另一端不超过对角线。
   */
  private constrain(f: Flip, P: Pt): Pt {
    const { W, H } = this.size;
    const near: Pt = { x: 0, y: f.top ? 0 : H };
    const far: Pt = { x: 0, y: f.top ? H : 0 };
    let q = P;
    const d1 = len(sub(q, near));
    if (d1 > W) q = { x: near.x + ((q.x - near.x) * W) / d1, y: near.y + ((q.y - near.y) * W) / d1 };
    const diag = Math.hypot(W, H);
    const d2 = len(sub(q, far));
    if (d2 > diag) q = { x: far.x + ((q.x - far.x) * diag) / d2, y: far.y + ((q.y - far.y) * diag) / d2 };
    return q;
  }

  /** 页角沿一条拱起来的弧线走到对面（done=true）或者落回原处。 */
  private animateTo(done: boolean, ms: number, ease: (t: number) => number): void {
    const f = this.flip!;
    const { W, H } = this.size;
    const C = this.corner(f);
    const to = done ? { x: -W, y: C.y } : C;
    // 走得越远拱得越高；从底角掀起往上拱，从顶角掀起往下拱
    const lift = (f.top ? 1 : -1) * LIFT * H * Math.min(1, Math.abs(to.x - f.P.x) / (2 * W));
    f.anim = { from: { ...f.P }, to, start: performance.now(), ms, ease, lift };
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    this.raf = 0;
    const f = this.flip;
    if (!f?.anim) return;
    const a = f.anim;
    const t = clamp01((now - a.start) / a.ms);
    const e = a.ease(t);
    f.P = {
      x: a.from.x + (a.to.x - a.from.x) * e,
      y: a.from.y + (a.to.y - a.from.y) * e + a.lift * Math.sin(Math.PI * e),
    };
    this.render();
    if (t < 1) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.finishFlip(a.to.x < 0);
    // 排着队的翻页：一页接一页快速翻
    while (this.queue.length) {
      const dir = this.queue.shift()!;
      if (this.canFlip(dir)) {
        this.beginFlip(dir, false);
        this.animateTo(true, RIFFLE_MS, this.queue.length ? (x) => x : easeOut);
        return;
      }
    }
  };

  /**
   * 按页角的位置把纸折好：正面沿折线裁掉折起来的部分；背面（下一张纸的另一面）
   * 镜像到折线另一侧盖上去；再沿折线画纸面的明暗和投在下面那页上的影子。
   */
  private render(): void {
    const f = this.flip;
    if (!f) return;
    const { W, H } = this.size;
    const C = this.corner(f);
    const P = f.P;
    const mir = (p: Pt): Pt => (f.dir > 0 ? p : { x: -p.x, y: p.y });
    const frontOx = f.dir > 0 ? 0 : -W;
    const backOx = f.dir > 0 ? -W : 0;
    const d = sub(C, P);
    const dl = len(d);
    const rect: Pt[] = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    if (dl < 0.5) {
      // 还没掀起来
      this.$front.style.clipPath = '';
      this.$back.style.clipPath = polyCss([]);
      for (const st of this.shadowRoot!.querySelectorAll<HTMLElement>('.strip')) st.style.visibility = 'hidden';
      return;
    }
    const n = { x: d.x / dl, y: d.y / dl };
    const F = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
    const side = (p: Pt) => dot(sub(p, F), n);
    const keep = clipPoly(rect, (p) => -side(p));
    const fold = clipPoly(rect, side);

    // 正面：只留没折起来的那部分
    const toFront = (q: Pt): Pt => {
      const r = mir(q);
      return { x: r.x - frontOx, y: r.y };
    };
    this.$front.style.clipPath = polyCss(keep.map(toFront));

    // 背面：纸上 q 点背后印的是对面那页 M(q) 位置的内容；它被折到 R(q)。
    // 背面元素的局部坐标 → 屏幕：l → 版面位置 → 镜像坐标 → 先 M 再 R → 回到真实坐标
    const reflect = (q: Pt): Pt => {
      const k = 2 * side(q);
      return { x: q.x - k * n.x, y: q.y - k * n.y };
    };
    const M = (q: Pt): Pt => ({ x: -q.x, y: q.y });
    const toScreen = (l: Pt): Pt => {
      const layout = { x: l.x + backOx, y: l.y };
      return mir(reflect(M(mir(layout))));
    };
    const o = toScreen({ x: 0, y: 0 });
    const ex = sub(toScreen({ x: 1, y: 0 }), o);
    const ey = sub(toScreen({ x: 0, y: 1 }), o);
    this.$back.style.transform = `matrix(${ex.x}, ${ex.y}, ${ey.x}, ${ey.y}, ${o.x - backOx}, ${o.y})`;
    const toBack = (q: Pt): Pt => {
      const r = mir(M(q));
      return { x: r.x - backOx, y: r.y };
    };
    this.$back.style.clipPath = polyCss(fold.map(toBack));

    // 折线上的两个点（镜像坐标）
    const along = { x: -n.y, y: n.x };
    const A = { x: F.x - along.x * 2000, y: F.y - along.y * 2000 };
    const B = { x: F.x + along.x * 2000, y: F.y + along.y * 2000 };
    const p = this.progress(f);
    const bend = Math.sin(Math.PI * Math.min(1, p * 1.15));
    const flapW = Math.max(10, Math.min(dl / 2, W));

    // 正面：靠近折线的地方因为纸拱起来而变暗
    this.strip(this.$front, toFront(A), toFront(B), toFront(P), 26 + 30 * bend, `rgba(0,0,0,${(0.22 * bend + 0.05).toFixed(3)}), transparent`);
    // 背面：弧面最高处一道亮光，往外慢慢变暗
    this.strip(
      this.$back,
      toBack(A),
      toBack(B),
      toBack(C),
      flapW * 0.8,
      `rgba(255,255,255,${(0.28 * bend).toFixed(3)}), rgba(0,0,0,${(0.1 * bend).toFixed(3)}) 55%, transparent`,
    );
    // 下面那页：被掀起的纸投下的影子，贴着折线往外
    const under = f.dir > 0 ? this.$right : this.$left;
    this.strip(under, toFront(A), toFront(B), toFront(C), 18 + 50 * bend, `rgba(0,0,0,${(0.3 * bend).toFixed(3)}), transparent`);
  }

  /** 沿一条线（a→b，局部坐标）铺一条渐变，从线上往 inside 那一侧淡出。 */
  private strip(host: HTMLElement, a: Pt, b: Pt, inside: Pt, width: number, stops: string): void {
    const el = host.querySelector(':scope > .fx > .strip') as HTMLElement;
    const d = sub(b, a);
    const l = len(d) || 1;
    const u = { x: d.x / l, y: d.y / l };
    let nrm = { x: -u.y, y: u.x };
    if (dot(sub(inside, a), nrm) < 0) nrm = { x: -nrm.x, y: -nrm.y };
    const mid = { x: (a.x + b.x) / 2 - u.x * 2000, y: (a.y + b.y) / 2 - u.y * 2000 };
    el.style.height = `${width}px`;
    el.style.background = `linear-gradient(to bottom, ${stops})`;
    el.style.transform = `matrix(${u.x}, ${u.y}, ${nrm.x}, ${nrm.y}, ${mid.x}, ${mid.y})`;
    el.style.visibility = 'visible';
  }

  /** 按当前的 m 摆好左右两页、页边和书签。 */
  private layout(): void {
    if (this.flip) return;
    const left = this.holder(this.$left).firstElementChild as HighlighterCalendar;
    const right = this.holder(this.$right).firstElementChild as HighlighterCalendar;
    this.setMonth(left, this.m);
    this.setMonth(right, this.m + 1);
    this.$prev.disabled = !this.canFlip(-1);
    this.$next.disabled = !this.canFlip(1);

    // 页边：两侧还剩多少张纸，就在书口露出几道纸边（最多 4 道，不会很厚）
    const lo = Math.max(this.range.minMonth, this.todayIndex - HORIZON);
    const hi = Math.min(this.range.maxMonth, this.todayIndex + HORIZON);
    const edges = (n: number, side: 1 | -1) => {
      const k = n <= 0 ? 0 : Math.min(4, 1 + Math.floor(n / 6));
      const parts: string[] = [];
      for (let i = 1; i <= k; i++) {
        parts.push(`${side * i * 1.5}px ${i}px 0 -1px var(--hb-paper)`, `${side * i * 1.5}px ${i}px 0 0 var(--hb-paper-edge)`);
      }
      return parts.length ? parts.join(', ') : '0 0 0 0 transparent';
    };
    this.$book.style.setProperty('--edges-left', edges(Math.ceil((this.m - lo) / 2), -1));
    this.$book.style.setProperty('--edges-right', edges(Math.ceil((hi - this.m - 1) / 2), 1));
    this.renderTabs();
  }

  /** 书签：有选中日子的月份，按月份在书口不同高度伸出一枚；翻过去的在左边，还没翻到的在右边。 */
  private renderTabs(): void {
    this.$tabsL.innerHTML = '';
    this.$tabsR.innerHTML = '';
    for (const r of this.shadowRoot!.querySelectorAll('.ribbon')) r.remove();
    // 每个月选了几天
    const counts = new Map<number, number>();
    for (const d of this.selection) {
      const k = monthIndex(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const h = this.$right.getBoundingClientRect().height || 360;
    const slotH = (h - 40) / 12;
    const used = new Map<string, number>();
    for (const [k, n] of [...counts].sort((a, b) => a[0] - b[0])) {
      const label = n >= 5 ? '5+' : String(n);
      const name = `${keyOf(k)}：${n} 天`;
      if (k === this.m || k === this.m + 1) {
        // 正在看的月份：书签夹进这一页，从页顶垂下来一截
        const rib = document.createElement('div');
        rib.className = 'ribbon';
        rib.textContent = label;
        rib.title = name;
        (k === this.m ? this.$left : this.$right).append(rib);
        continue;
      }
      // 翻过去的在左边书口，还没翻到的在右边书口，按月份排在不同高度
      const side = k < this.m ? this.$tabsL : this.$tabsR;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.textContent = label;
      tab.title = name;
      tab.setAttribute('aria-label', name);
      // 同一侧同一高度已经有书签（不同年份的同一个月）：往外再错开一点
      const spot = `${side === this.$tabsL ? 'l' : 'r'}${m0Of(k)}`;
      const extra = used.get(spot) ?? 0;
      used.set(spot, extra + 1);
      tab.style.top = `${12 + m0Of(k) * slotH}px`;
      tab.style.height = `${Math.max(16, Math.min(22, slotH - 4))}px`;
      tab.style.marginLeft = side === this.$tabsR ? `${extra * 8}px` : '';
      tab.style.marginRight = side === this.$tabsL ? `${extra * 8}px` : '';
      tab.addEventListener('click', () => this.goTo(k));
      side.append(tab);
    }
  }

  /** 翻到让月份 k 出现在左页或右页（一页接一页快速翻过去）。 */
  private goTo(k: number): void {
    if (this.flip) return;
    const n = k < this.m ? -Math.ceil((this.m - k) / 2) : k > this.m + 1 ? Math.ceil((k - this.m - 1) / 2) : 0;
    if (!n) return;
    const dir: 1 | -1 = n > 0 ? 1 : -1;
    for (let i = 1; i < Math.abs(n); i++) this.queue.push(dir);
    this.request(dir, true);
  }

  // ---------- 选择 ----------

  private sync(from: HighlighterCalendar): void {
    this.selection = from.value;
    for (const c of this.pages) if (c !== from) c.value = this.selection;
    this.selectionChanged();
  }

  private selectionChanged(): void {
    if (!this.flip) this.renderTabs();
  }

  /** 某一页自己翻了月（键盘移出本月）：整本书跟着走。 */
  private onPageMonth(c: HighlighterCalendar): void {
    if (this.flip) return;
    const k = parseKey(c.month);
    if (k === null) return;
    const isLeft = c.parentElement === this.holder(this.$left);
    this.m = this.clampLeft(isLeft ? k : k - 1);
    this.layout();
    this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  // ---------- 手势：按住空白处横着拖，纸跟着手指翻 ----------

  private isBlank(e: Event): boolean {
    return !e
      .composedPath()
      .some((n) => n instanceof HTMLElement && (n.classList.contains('wrap') || n.localName === 'button'));
  }

  private onDown(e: PointerEvent): void {
    if (this.gesture || (e.pointerType === 'mouse' && e.button !== 0) || !this.isBlank(e)) return;
    this.gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, mode: 'idle', samples: [{ t: e.timeStamp, x: e.clientX }] };
    try {
      this.$book.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件没有真实指针
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
      this.stopHint();
      if (this.flip) {
        // 上一页还在翻：这一下算"再翻一页"
        g.mode = 'flick';
        this.queue.push(dir);
        return;
      }
      if (!this.canFlip(dir)) {
        g.mode = 'scroll';
        return;
      }
      g.mode = 'drag';
      // 按在页面上半部分就掀上面的角，下半部分就掀下面的角
      const r = this.$spread.getBoundingClientRect();
      this.beginFlip(dir, g.y < r.top + r.height / 2);
    }
    if (g.mode !== 'drag' || !this.flip) return;
    // 页角跟着手指走（按手指移动的距离，不管从哪里按下去的）
    const f = this.flip;
    const C = this.corner(f);
    const mdx = f.dir > 0 ? dx : -dx;
    f.P = this.constrain(f, { x: C.x + mdx * 1.1, y: C.y + dy * 0.6 });
    this.render();
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    if (g.mode !== 'drag' || !this.flip) return;
    const s0 = g.samples[0];
    const vx = e.timeStamp > s0.t ? (e.clientX - s0.x) / (e.timeStamp - s0.t) : 0;
    const f = this.flip;
    const along = f.dir > 0 ? -vx : vx;
    const p = this.progress(f);
    const go = !cancelled && (p >= COMMIT || along > FLICK_SPEED) && along > -FLICK_SPEED;
    this.animateTo(go, Math.max(180, FLIP_MS * 0.75 * (go ? 1 - p : p)), easeOut);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-book': HighlighterBook;
  }
}
