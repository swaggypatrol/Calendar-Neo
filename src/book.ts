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
  display: grid;
  grid-template-columns: auto auto;
  justify-content: center;
  width: max-content;
  margin: 0 auto;
  padding: 10px 40px 30px;
  perspective: 2200px;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.page, .face {
  position: relative;
  box-sizing: border-box;
  padding: 16px 18px 14px;
  background:
    radial-gradient(120% 90% at 50% 40%, transparent 60%, rgba(120, 90, 40, 0.05)),
    var(--hb-paper);
}
.page.left, .face.back { border-radius: 10px 2px 2px 10px; }
.page.right, .face.front { border-radius: 2px 10px 10px 2px; }
.page.left { box-shadow: var(--edges-left, none), -6px 14px 28px -10px var(--hb-shadow); }
.page.right { box-shadow: var(--edges-right, none), 6px 14px 28px -10px var(--hb-shadow); }
/* 中缝：靠近装订处的阴影 */
.gutter {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
}
.page.left .gutter, .face.back .gutter { background: linear-gradient(to left, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.04) 5%, transparent 14%); }
.page.right .gutter, .face.front .gutter { background: linear-gradient(to right, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.04) 5%, transparent 14%); }
/* 翻页时：压在下面的那一页被翻起来的纸遮出的影子；翻着的纸面上随角度变化的明暗 */
.shade, .light {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  opacity: 0;
}
.page.right .shade { background: linear-gradient(to right, rgba(0, 0, 0, 0.35), transparent 70%); }
.page.left .shade { background: linear-gradient(to left, rgba(0, 0, 0, 0.35), transparent 70%); }
.face.front .light { background: linear-gradient(to left, rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.05)); }
.face.back .light { background: linear-gradient(to right, rgba(255, 255, 255, 0.35), rgba(0, 0, 0, 0.12)); }
.sheet {
  position: absolute;
  top: 10px;
  left: 50%;
  transform-origin: 0 50%;
  transform-style: preserve-3d;
  visibility: hidden;
  z-index: 5;
}
.sheet.on { visibility: visible; }
.face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.face.back { transform: rotateY(180deg); }
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
  width: 34px;
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
.tabs.left .tab:hover { transform: translateX(-3px); }
`;

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay', 'min', 'max'];

interface Flip {
  dir: 1 | -1;
  /** 翻过去的程度 0..1。 */
  p: number;
  anim: { from: number; to: number; start: number; ms: number; ease: (t: number) => number } | null;
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
  private $sheet: HTMLElement;
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
  private months = new Set<number>();
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
        <div class="page left"><div class="slot"></div><div class="gutter"></div><div class="shade"></div></div>
        <div class="page right"><div class="slot"></div><div class="gutter"></div><div class="shade"></div></div>
        <div class="tabs right"></div>
        <div class="sheet">
          <div class="face front"><div class="slot"></div><div class="gutter"></div><div class="light"></div></div>
          <div class="face back"><div class="slot"></div><div class="gutter"></div><div class="light"></div></div>
        </div>
        <button class="corner prev" type="button" aria-label="上一页"></button>
        <button class="corner next" type="button" aria-label="下一页"></button>
        <div class="pool" aria-hidden="true"></div>
      </div>`;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$book = q('.book');
    this.$left = q('.page.left');
    this.$right = q('.page.right');
    this.$sheet = q('.sheet');
    this.$front = q('.face.front');
    this.$back = q('.face.back');
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
    if (this.flip) this.finishFlip(this.flip.p >= 0.5);
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
    this.beginFlip(1);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (!this.flip || this.gesture || t > 1.1) {
        this.hintRaf = 0;
        if (this.flip && !this.flip.anim) this.finishFlip(false);
        return;
      }
      this.flip.p = 0.07 * Math.abs(Math.sin((t * Math.PI) / 0.34)) * Math.exp(-t * 2.4);
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
    this.beginFlip(dir);
    this.animateTo(1, fast ? RIFFLE_MS : FLIP_MS, fast ? easeOut : easeInOut);
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
   * 开始翻一页。往后翻：右页那张纸（正面 m+1、背面 m+2）绕中缝往左翻，下面露出 m+3；
   * 往前翻：左页那张纸（背面 m、正面 m-1）翻回右边，左边露出 m-2。
   */
  private beginFlip(dir: 1 | -1): void {
    // 翻着的那张纸和一页一样大，盖在右页上，绕中缝转
    this.$sheet.style.width = `${this.$right.offsetWidth}px`;
    this.$sheet.style.height = `${this.$right.offsetHeight}px`;
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
      this.holder(this.$back).append(left);
      this.holder(this.$front).append(a);
      this.holder(this.$left).append(b);
    }
    this.flip = { dir, p: 0, anim: null };
    this.$sheet.classList.add('on');
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
        this.holder(this.$right).append(front);
        this.$pool.append(oldRight, back);
        this.m -= 2;
      } else {
        const under = this.holder(this.$left).firstElementChild as HighlighterCalendar;
        this.holder(this.$left).append(back);
        this.$pool.append(under, front);
      }
    }
    this.flip = null;
    this.$sheet.classList.remove('on');
    this.$book.classList.remove('busy');
    this.$left.querySelector<HTMLElement>('.shade')!.style.opacity = '0';
    this.$right.querySelector<HTMLElement>('.shade')!.style.opacity = '0';
    this.layout();
    if (done) this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  private animateTo(to: number, ms: number, ease: (t: number) => number): void {
    const f = this.flip!;
    f.anim = { from: f.p, to, start: performance.now(), ms, ease };
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    this.raf = 0;
    const f = this.flip;
    if (!f?.anim) return;
    const a = f.anim;
    const t = clamp01((now - a.start) / a.ms);
    f.p = a.from + (a.to - a.from) * a.ease(t);
    this.render();
    if (t < 1) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.finishFlip(a.to === 1);
    // 排着队的翻页：一页接一页快速翻
    while (this.queue.length) {
      const dir = this.queue.shift()!;
      if (this.canFlip(dir)) {
        this.beginFlip(dir);
        this.animateTo(1, RIFFLE_MS, this.queue.length ? (x) => x : easeOut);
        return;
      }
    }
  };

  /** 按翻页进度摆好那张纸，并画出纸面明暗和压在下面那页上的影子。 */
  private render(): void {
    const f = this.flip;
    if (!f) return;
    const deg = f.dir > 0 ? -180 * f.p : -180 * (1 - f.p);
    this.$sheet.style.transform = `rotateY(${deg}deg)`;
    const s = Math.sin((Math.abs(deg) * Math.PI) / 180);
    (this.$front.querySelector('.light') as HTMLElement).style.opacity = String(s * 0.9);
    (this.$back.querySelector('.light') as HTMLElement).style.opacity = String(s * 0.7);
    const under = f.dir > 0 ? this.$right : this.$left;
    const other = f.dir > 0 ? this.$left : this.$right;
    (under.querySelector('.shade') as HTMLElement).style.opacity = String(Math.abs(deg) < 90 ? s * 0.8 : 0);
    (other.querySelector('.shade') as HTMLElement).style.opacity = String(Math.abs(deg) >= 90 ? s * 0.8 : 0);
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
    const lang = (this.getAttribute('locale') ?? navigator.language ?? 'en').toLowerCase();
    const fmt = new Intl.DateTimeFormat(this.getAttribute('locale') ?? navigator.language, {
      month: /^(zh|ja|ko)/.test(lang) ? 'numeric' : 'short',
    });
    const thisYear = new Date().getFullYear();
    const h = this.$right.getBoundingClientRect().height || 360;
    const slotH = (h - 40) / 12;
    const used = new Map<string, number>();
    for (const k of [...this.months].sort((a, b) => a - b)) {
      const side = k <= this.m ? this.$tabsL : this.$tabsR;
      const y = Math.floor(k / 12);
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      const label = fmt.format(new Date(y, m0Of(k), 1));
      tab.textContent = y === thisYear ? label : `${label}·${String(y).slice(2)}`;
      tab.title = keyOf(k);
      // 同一侧同一高度已经有书签（不同年份的同一个月）：往外再错开一点
      const spot = `${side === this.$tabsL ? 'l' : 'r'}${m0Of(k)}`;
      const n = used.get(spot) ?? 0;
      used.set(spot, n + 1);
      tab.style.top = `${12 + m0Of(k) * slotH}px`;
      tab.style.height = `${Math.max(16, Math.min(22, slotH - 4))}px`;
      tab.style.marginLeft = side === this.$tabsR ? `${n * 8}px` : '';
      tab.style.marginRight = side === this.$tabsL ? `${n * 8}px` : '';
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
    this.months = new Set(this.selection.map((d) => monthIndex(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1)));
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
      this.beginFlip(dir);
    }
    if (g.mode !== 'drag' || !this.flip) return;
    // 纸边跟着手指：拖过一页多一点的距离就整页翻过去
    const w = this.$right.getBoundingClientRect().width;
    const along = this.flip.dir > 0 ? -dx : dx;
    this.flip.p = clamp01(along / (w * 1.1));
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
    const go = !cancelled && (f.p >= COMMIT || along > FLICK_SPEED) && along > -FLICK_SPEED;
    const to = go ? 1 : 0;
    this.animateTo(to, Math.max(160, FLIP_MS * 0.7 * Math.abs(to - f.p)), easeOut);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-book': HighlighterBook;
  }
}
