import { DEFAULT_THRESHOLD, HighlighterEngine, type DayRect, type FlipEvent, type RowLayout, type Tool } from './engine';
import { InkCanvas, type Run } from './ink';

export interface CalendarChangeDetail {
  /** 全部选中的日期，YYYY-MM-DD，升序。 */
  value: string[];
  added: string[];
  removed: string[];
}

type FlipContext = 'stroke' | 'hold' | 'tap' | 'key' | 'api';

interface PointerState {
  id: number;
  tool: Tool;
  downAt: number;
  downX: number;
  downY: number;
  stillX: number;
  stillY: number;
  stillSince: number;
  moved: boolean;
  holdStarted: boolean;
  startValue: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const dateKey = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

const DEFAULT_INK = '#ffd21f';

const STYLE = /* css */ `
:host {
  --hc-ink: ${DEFAULT_INK};
  --hc-bg: #ffffff;
  --hc-fg: #1d2127;
  --hc-muted: #8a9099;
  --hc-line: rgba(20, 30, 50, 0.07);
  --hc-accent: #e8590c;
  --hc-radius: 10px;
  --hc-gap: 4px;
  display: inline-block;
  width: 22rem;
  max-width: 100%;
  color: var(--hc-fg);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :host {
    --hc-bg: #1c1f24;
    --hc-fg: #e8eaed;
    --hc-muted: #8d949e;
    --hc-line: rgba(255, 255, 255, 0.08);
  }
  .day.selected { color: #1d2127; }
}
.hc {
  background: var(--hc-bg);
  border-radius: 16px;
  padding: 14px 14px 12px;
  box-sizing: border-box;
}
header {
  user-select: none;
  -webkit-user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px 10px;
}
.title { font-weight: 650; font-size: 1.02rem; }
.nav {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.nav:hover { background: var(--hc-line); }
.hc.hide-nav .nav { visibility: hidden; }
.nav:focus-visible { outline: 2px solid var(--hc-accent); }
.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--hc-gap);
  margin-bottom: 4px;
}
.weekdays span { text-align: center; font-size: 0.72rem; color: var(--hc-muted); }
.wrap {
  position: relative;
  margin: -8px;
  padding: 8px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: crosshair;
}
.wrap.brush-cursor { cursor: none; }
canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--hc-gap);
}
.row { display: contents; }
.day {
  position: relative;
  aspect-ratio: 1 / 0.84;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--hc-radius);
  box-shadow: inset 0 0 0 1px var(--hc-line);
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.day.blank { box-shadow: none; }
.day.selected { font-weight: 650; }
.day.today::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 12%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: var(--hc-accent);
}
.day:focus-visible { box-shadow: inset 0 0 0 2px var(--hc-accent); }
.cursor {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  border-radius: 50%;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--hc-ink) 30%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--hc-ink) 75%, #000 25%);
  opacity: 0;
  transition: opacity 0.12s;
}
.cursor.on { opacity: 1; }
.cursor.erase {
  background: rgba(255, 255, 255, 0.35);
  border: 1.5px dashed var(--hc-muted);
  border-radius: 6px;
}
`;

const TEMPLATE = `
<style>${STYLE}</style>
<div class="hc" part="root">
  <header part="header">
    <button class="nav prev" part="nav" type="button">‹</button>
    <div class="title" part="title" aria-live="polite"></div>
    <button class="nav next" part="nav" type="button">›</button>
  </header>
  <div class="weekdays" part="weekdays"></div>
  <div class="wrap">
    <canvas></canvas>
    <div class="grid" role="grid"></div>
    <div class="cursor"></div>
  </div>
</div>
`;

/**
 * <highlighter-calendar>：像荧光笔一样划选日期的日历。
 *
 * 属性：month="2026-09"  threshold="35"  week-start="1|0"  locale="zh-CN"
 *       color="#ffd21f"  tool="highlight|erase"  brush-size="1"  hold-delay="320"
 *       value="2026-09-03,2026-09-04"
 * 事件：input（划的过程中每选中/取消一天触发）、change（松手后，若有变化）、monthchange
 */
export class HighlighterCalendar extends HTMLElement {
  static observedAttributes = [
    'month',
    'threshold',
    'week-start',
    'locale',
    'color',
    'tool',
    'brush-size',
    'hold-delay',
    'value',
    'hide-nav',
  ];

  readonly engine = new HighlighterEngine();

  private ink: InkCanvas;
  private $title: HTMLElement;
  private $weekdays: HTMLElement;
  private $wrap: HTMLElement;
  private $grid: HTMLElement;
  private $canvas: HTMLCanvasElement;
  private $cursor: HTMLElement;

  private year: number;
  private month0: number;
  private weekStart = 1;
  private locale: string | undefined;
  private _tool: Tool = 'highlight';
  private _color = DEFAULT_INK;
  private holdDelay = 320;

  private dayEls = new Map<string, HTMLElement>();
  private cells: HTMLElement[] = [];
  private ptr: PointerState | null = null;
  private flipCtx: FlipContext = 'api';
  private tapY = 0;
  private pendingComplete = new Set<string>();
  private raf = 0;
  private lastT = 0;
  private size = { w: 0, h: 0, dpr: 0 };
  private gap = 4;
  private focusKey: string | null = null;
  private ro: ResizeObserver | null = null;
  private dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.$title = q('.title');
    this.$weekdays = q('.weekdays');
    this.$wrap = q('.wrap');
    this.$grid = q('.grid');
    this.$canvas = q('canvas');
    this.$cursor = q('.cursor');
    this.ink = new InkCanvas(this.$canvas);
    this.engine.onFlip = (e) => this.handleFlip(e);
    this.ink.boost = !!this.dark?.matches;
    this.dark?.addEventListener('change', (e) => {
      this.ink.boost = e.matches;
      this.kick();
    });

    const now = new Date();
    this.year = now.getFullYear();
    this.month0 = now.getMonth();

    q('.prev').addEventListener('click', () => this.shiftMonth(-1));
    q('.next').addEventListener('click', () => this.shiftMonth(1));
    const w = this.$wrap;
    w.addEventListener('pointerdown', (e) => this.onDown(e));
    w.addEventListener('pointermove', (e) => this.onMove(e));
    w.addEventListener('pointerup', (e) => this.onUp(e, false));
    w.addEventListener('pointercancel', (e) => this.onUp(e, true));
    w.addEventListener('pointerleave', () => this.$cursor.classList.remove('on'));
    w.addEventListener('contextmenu', (e) => e.preventDefault());
    this.$grid.addEventListener('keydown', (e) => this.onKey(e));
    this.$grid.addEventListener('focusin', (e) => {
      const key = (e.target as HTMLElement).dataset?.key;
      if (key) this.setFocusKey(key);
    });
  }

  connectedCallback(): void {
    this.render();
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.$wrap);
  }

  disconnectedCallback(): void {
    this.ro?.disconnect();
    this.ro = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    switch (name) {
      case 'month':
        if (v) this.month = v;
        break;
      case 'threshold':
        this.threshold = v === null ? DEFAULT_THRESHOLD : Number(v);
        break;
      case 'week-start':
        this.weekStart = v === null ? 1 : ((Number(v) % 7) + 7) % 7 || 0;
        this.render();
        break;
      case 'locale':
        this.locale = v ?? undefined;
        this.render();
        break;
      case 'color':
        this.color = v ?? DEFAULT_INK;
        break;
      case 'tool':
        this.tool = v === 'erase' ? 'erase' : 'highlight';
        break;
      case 'brush-size':
        this.engine.brushScale = Math.min(2, Math.max(0.5, Number(v) || 1));
        this.measure(true);
        break;
      case 'hold-delay':
        this.holdDelay = Math.max(80, Number(v) || 320);
        break;
      case 'hide-nav':
        this.shadowRoot!.querySelector('.hc')!.classList.toggle('hide-nav', v !== null);
        break;
      case 'value':
        this.value = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        break;
    }
  }

  // ---------- 公开 API ----------

  /** 选中的日期（YYYY-MM-DD，升序）。可以不连续，跨月也行。 */
  get value(): string[] {
    return this.engine.value;
  }

  set value(keys: string[]) {
    const visible = [...this.dayEls.keys()];
    const shown = () => visible.filter((k) => this.engine.isSelected(k)).join();
    const before = shown();
    this.engine.setSelection(keys);
    // 本月可见的日期没变（比如别的月份的卡片改了选择）：不重画，保留手绘笔迹
    if (shown() === before) return;
    this.syncDom();
    this.measure(true);
  }

  /** 多少个小格（共 64 个）被涂上才算选中，默认 35。 */
  get threshold(): number {
    return this.engine.threshold;
  }

  set threshold(n: number) {
    this.engine.threshold = Number.isFinite(n) ? n : DEFAULT_THRESHOLD;
  }

  /** 当前显示的月份，格式 YYYY-MM。 */
  get month(): string {
    return `${this.year}-${pad2(this.month0 + 1)}`;
  }

  set month(v: string) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(v);
    if (!m) return;
    this.year = Number(m[1]);
    this.month0 = Math.min(11, Math.max(0, Number(m[2]) - 1));
    this.render();
  }

  /** 左键 / 触摸用的工具。右键和笔的橡皮头永远是橡皮擦。 */
  get tool(): Tool {
    return this._tool;
  }

  set tool(t: Tool) {
    this._tool = t;
    this.$cursor.classList.toggle('erase', t === 'erase');
  }

  get color(): string {
    return this._color;
  }

  set color(c: string) {
    this._color = c;
    this.style.setProperty('--hc-ink', c);
    this.ink.setColor(c);
    this.kick();
  }

  /** 清空所有选择（带淡出动画）。silent=true 时不触发 change。 */
  clear(silent = false): void {
    const before = this.value;
    if (!before.length) return;
    this.engine.setSelection([]);
    this.syncDom();
    this.updateRuns();
    this.ink.prune();
    if (!silent) this.emit('change', before);
    this.kick();
  }

  shiftMonth(delta: number): void {
    const d = new Date(this.year, this.month0 + delta, 1);
    this.year = d.getFullYear();
    this.month0 = d.getMonth();
    this.render();
    this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  // ---------- 渲染 ----------

  private render(): void {
    const { year: y, month0: m } = this;
    const fmt = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' });
    this.$title.textContent = fmt.format(new Date(y, m, 1));
    this.$grid.setAttribute('aria-label', this.$title.textContent);

    const wd = new Intl.DateTimeFormat(this.locale, { weekday: 'narrow' });
    this.$weekdays.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('span');
      // 2023-01-01 是星期日
      s.textContent = wd.format(new Date(2023, 0, 1 + ((this.weekStart + i) % 7)));
      this.$weekdays.append(s);
    }

    const offset = (new Date(y, m, 1).getDay() - this.weekStart + 7) % 7;
    const dim = new Date(y, m + 1, 0).getDate();
    const now = new Date();
    const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
    const label = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

    this.$grid.innerHTML = '';
    this.dayEls.clear();
    this.cells = [];
    let row: HTMLElement | null = null;
    for (let i = 0; i < 42; i++) {
      if (i % 7 === 0) {
        row = document.createElement('div');
        row.className = 'row';
        row.setAttribute('role', 'row');
        this.$grid.append(row);
      }
      const d = i - offset + 1;
      const el = document.createElement('div');
      el.className = 'day';
      el.setAttribute('role', 'gridcell');
      if (d < 1 || d > dim) {
        el.classList.add('blank');
        el.setAttribute('aria-hidden', 'true');
      } else {
        const key = dateKey(y, m, d);
        el.dataset.key = key;
        el.tabIndex = -1;
        el.setAttribute('aria-label', label.format(new Date(y, m, d)));
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = String(d);
        el.append(num);
        if (key === todayKey) el.classList.add('today');
        this.dayEls.set(key, el);
      }
      this.cells.push(el);
      row!.append(el);
    }
    this.syncDom();

    const keys = [...this.dayEls.keys()];
    const first = keys.find((k) => this.engine.isSelected(k)) ?? (this.dayEls.has(todayKey) ? todayKey : keys[0]);
    this.setFocusKey(first);
    this.measure(true);
  }

  private syncDom(): void {
    for (const [key, el] of this.dayEls) {
      const sel = this.engine.isSelected(key);
      el.classList.toggle('selected', sel);
      el.setAttribute('aria-selected', String(sel));
    }
  }

  private setFocusKey(key: string): void {
    if (this.focusKey) this.dayEls.get(this.focusKey)?.setAttribute('tabindex', '-1');
    this.focusKey = key;
    this.dayEls.get(key)?.setAttribute('tabindex', '0');
  }

  /** 量一下各日期格的位置交给引擎；尺寸变了（或 force）就重画墨迹。 */
  private measure(force = false): void {
    if (!this.isConnected || this.ptr) return;
    const box = this.$wrap.getBoundingClientRect();
    if (box.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const resized = box.width !== this.size.w || box.height !== this.size.h || dpr !== this.size.dpr;
    if (resized) {
      this.size = { w: box.width, h: box.height, dpr };
      this.ink.resize(box.width, box.height, dpr);
      this.ink.setColor(this._color);
    }

    const rows: RowLayout[] = [];
    for (let r = 0; r < 6; r++) {
      const rc = this.cells[r * 7].getBoundingClientRect();
      const row: RowLayout = { top: rc.top - box.top, bottom: rc.bottom - box.top, days: [] };
      for (let c = 0; c < 7; c++) {
        const el = this.cells[r * 7 + c];
        const key = el.dataset.key;
        if (!key) continue;
        const b = el.getBoundingClientRect();
        row.days.push({
          key,
          slot: c,
          left: b.left - box.left,
          top: b.top - box.top,
          right: b.right - box.left,
          bottom: b.bottom - box.top,
        });
      }
      rows.push(row);
    }
    const a = this.cells[0].getBoundingClientRect();
    const b = this.cells[1].getBoundingClientRect();
    this.gap = Math.max(0, b.left - a.right);
    this.engine.setLayout(rows);
    this.updateRuns();

    if (resized || force) {
      this.ink.clear();
      this.paintStatic();
    }
    this.kick();
  }

  /** 选中区域：同一行里连续选中的日期连成一段。 */
  private runs(): (Run & { days: DayRect[] })[] {
    const out: (Run & { days: DayRect[] })[] = [];
    for (const row of this.engine.layout) {
      let cur: (Run & { days: DayRect[] }) | null = null;
      let lastSlot = -2;
      for (const d of row.days) {
        if (!this.engine.isSelected(d.key)) {
          cur = null;
          continue;
        }
        if (cur && d.slot === lastSlot + 1) {
          cur.right = d.right;
          cur.days.push(d);
        } else {
          cur = { left: d.left, right: d.right, top: d.top, bottom: d.bottom, days: [d] };
          out.push(cur);
        }
        lastSlot = d.slot;
      }
    }
    return out;
  }

  private updateRuns(): void {
    this.ink.setRuns(this.runs(), this.gap * 0.9 + 1);
  }

  /** 不带动画地给所有选中日期补上笔迹（翻月、改尺寸、程序设值时）。 */
  private paintStatic(): void {
    for (const run of this.runs()) {
      const r = run.days[0];
      const { ry } = this.engine.brushRadius(r);
      const h = r.bottom - r.top;
      const cy = (run.top + run.bottom) / 2 + (Math.random() - 0.5) * h * 0.06;
      const rise = h * 0.03;
      this.ink.sweep(run.left - 3, cy + rise / 2, run.right + 3, cy - rise / 2, ry, false);
    }
  }

  /** 自动划一笔穿过某天。dir=1 从左往右，-1 从右往左。 */
  private sweepDay(r: DayRect, y: number, dir: 1 | -1, delay = 0): void {
    const { ry } = this.engine.brushRadius(r);
    const h = r.bottom - r.top;
    const yc = Math.min(r.bottom - ry * 0.8, Math.max(r.top + ry * 0.8, y));
    const rise = h * 0.035;
    const xl = r.left - 3;
    const xr = r.right + 3;
    if (dir > 0) this.ink.sweep(xl, yc + rise / 2, xr, yc - rise / 2, ry, true, delay);
    else this.ink.sweep(xr, yc - rise / 2, xl, yc + rise / 2, ry, true, delay);
  }

  private handleFlip(e: FlipEvent): void {
    const el = this.dayEls.get(e.key);
    if (el) {
      el.classList.toggle('selected', e.selected);
      el.setAttribute('aria-selected', String(e.selected));
    }
    this.updateRuns();
    const st = this.engine.state(e.key);
    if (st) {
      const r = st.rect;
      if (!e.selected) {
        this.pendingComplete.delete(e.key);
        this.ink.prune();
      } else if (this.flipCtx === 'stroke') {
        this.pendingComplete.add(e.key);
      } else if (this.flipCtx === 'hold') {
        // 停笔太久：从笔停的地方，顺着最自然的方向划一笔
        const hp = this.engine.holdPoint;
        const dir = hp && hp.x > r.right ? -1 : 1;
        this.sweepDay(r, hp?.y ?? (r.top + r.bottom) / 2, dir);
      } else if (this.flipCtx === 'tap') {
        this.sweepDay(r, this.tapY, 1);
      } else {
        this.sweepDay(r, (r.top + r.bottom) / 2, 1);
      }
    }
    this.dispatchEvent(
      new CustomEvent<CalendarChangeDetail>('input', {
        detail: { value: this.value, added: e.selected ? [e.key] : [], removed: e.selected ? [] : [e.key] },
        bubbles: true,
        composed: true,
      }),
    );
    this.kick();
  }

  /** 松手后：划得不够完整的已选日期，顺着原来的方向把笔补完。 */
  private completeStrokes(): void {
    for (const key of this.pendingComplete) {
      const st = this.engine.state(key);
      if (!st || !st.selected) continue;
      const r = st.rect;
      const cov = this.engine.coverage.get(key);
      if (!cov) {
        this.sweepDay(r, (r.top + r.bottom) / 2, 1);
        continue;
      }
      const { rx, ry } = this.engine.brushRadius(r);
      const w = r.right - r.left;
      const y = Math.min(r.bottom - ry * 0.8, Math.max(r.top + ry * 0.8, cov.sumY / cov.n));
      if (cov.maxX + rx < r.right - w * 0.1) this.ink.sweep(cov.maxX, y, r.right + 3, y - 1, ry, true);
      if (cov.minX - rx > r.left + w * 0.1) this.ink.sweep(cov.minX, y, r.left - 3, y - 1, ry, true);
    }
    this.pendingComplete.clear();
  }

  private emit(type: 'change', before: string[]): void {
    const now = this.value;
    const b = new Set(before);
    const n = new Set(now);
    const added = now.filter((k) => !b.has(k));
    const removed = before.filter((k) => !n.has(k));
    if (!added.length && !removed.length) return;
    this.dispatchEvent(
      new CustomEvent<CalendarChangeDetail>(type, {
        detail: { value: now, added, removed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------- 指针 ----------

  private local(e: PointerEvent): { x: number; y: number } {
    const b = this.$wrap.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  private onDown(e: PointerEvent): void {
    if (this.ptr) return;
    const eraser = e.button === 2 || e.button === 5;
    if (e.pointerType === 'mouse' && e.button !== 0 && !eraser) return;
    e.preventDefault();
    this.measure();
    const tool: Tool = eraser ? 'erase' : this._tool;
    const { x, y } = this.local(e);
    const r0 = this.engine.layout[0]?.days[0];
    if (!r0) return;
    try {
      this.$wrap.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件等没有真实指针时拿不到捕获，不影响涂画
    }
    this.ptr = {
      id: e.pointerId,
      tool,
      downAt: e.timeStamp,
      downX: x,
      downY: y,
      stillX: x,
      stillY: y,
      stillSince: e.timeStamp,
      moved: false,
      holdStarted: false,
      startValue: this.value,
    };
    this.ink.beginLive(tool, x, y, e.timeStamp, this.engine.brushRadius(r0).ry);
    this.flipCtx = 'stroke';
    this.engine.beginStroke(tool, x, y);
    this.updateCursor(e);
    this.kick();
  }

  private onMove(e: PointerEvent): void {
    this.updateCursor(e);
    const p = this.ptr;
    if (!p || e.pointerId !== p.id) return;
    const list = e.getCoalescedEvents?.() ?? [];
    for (const ev of list.length ? list : [e]) {
      const { x, y } = this.local(ev);
      if (Math.hypot(x - p.stillX, y - p.stillY) > 4) {
        p.stillX = x;
        p.stillY = y;
        p.stillSince = ev.timeStamp;
        if (p.holdStarted) {
          this.engine.cancelHold();
          p.holdStarted = false;
        }
      }
      if (Math.hypot(x - p.downX, y - p.downY) > 6) p.moved = true;
      this.flipCtx = 'stroke';
      this.engine.moveTo(x, y);
      this.ink.liveTo(x, y, ev.timeStamp);
    }
    this.kick();
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const p = this.ptr;
    if (!p || e.pointerId !== p.id) return;
    const { x, y } = this.local(e);
    const tap = !cancelled && !p.moved && !p.holdStarted && e.timeStamp - p.downAt < this.holdDelay;
    if (tap) {
      // 单击：像点了一滴墨，这一天被一笔划过选中（右键则擦掉）
      this.flipCtx = 'tap';
      this.tapY = y;
      this.engine.tap(x, y);
    }
    this.flipCtx = 'stroke';
    this.engine.endStroke();
    this.ink.endLive(!tap);
    this.completeStrokes();
    if (p.tool === 'highlight') this.ink.prune();
    this.ptr = null;
    this.flipCtx = 'api';
    this.emit('change', p.startValue);
    this.kick();
  }

  private updateCursor(e: PointerEvent): void {
    const c = this.$cursor;
    if (e.pointerType === 'touch') {
      c.classList.remove('on');
      this.$wrap.classList.remove('brush-cursor');
      return;
    }
    const r0 = this.engine.layout[0]?.days[0];
    if (!r0) return;
    const { rx, ry } = this.engine.brushRadius(r0);
    const { x, y } = this.local(e);
    const erase = this.ptr ? this.ptr.tool === 'erase' : this._tool === 'erase' || (e.buttons & 2) !== 0;
    c.classList.toggle('erase', erase);
    const w = erase ? ry : rx * 2;
    c.style.width = `${w}px`;
    c.style.height = `${ry * 2}px`;
    c.style.transform = `translate(${x - w / 2}px, ${y - ry}px) rotate(8deg)`;
    c.classList.add('on');
    this.$wrap.classList.add('brush-cursor');
  }

  // ---------- 键盘 ----------

  private onKey(e: KeyboardEvent): void {
    const key = this.focusKey;
    if (!key) return;
    const [y, m, d] = key.split('-').map(Number);
    const move = (days: number) => {
      const t = new Date(y, m - 1, d + days);
      const k = dateKey(t.getFullYear(), t.getMonth(), t.getDate());
      if (t.getMonth() !== this.month0 || t.getFullYear() !== this.year) {
        this.shiftMonth(t.getFullYear() * 12 + t.getMonth() - (this.year * 12 + this.month0));
      }
      this.setFocusKey(k);
      this.dayEls.get(k)?.focus();
    };
    switch (e.key) {
      case 'ArrowLeft':
        move(-1);
        break;
      case 'ArrowRight':
        move(1);
        break;
      case 'ArrowUp':
        move(-7);
        break;
      case 'ArrowDown':
        move(7);
        break;
      case 'PageUp':
        this.shiftMonth(-1);
        break;
      case 'PageDown':
        this.shiftMonth(1);
        break;
      case 'Enter':
      case ' ': {
        const before = this.value;
        this.flipCtx = 'key';
        this.engine.setDay(key, !this.engine.isSelected(key));
        this.flipCtx = 'api';
        this.emit('change', before);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  }

  // ---------- 动画循环 ----------

  private kick(): void {
    if (!this.raf && this.isConnected) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    this.raf = 0;
    const dt = this.lastT ? Math.min(50, t - this.lastT) : 16;
    this.lastT = t;
    const p = this.ptr;
    if (p) {
      const still = t - p.stillSince;
      // 停着不动：墨水在笔尖下慢慢洇开变深
      if (still > 140) this.ink.pool(p.stillX, p.stillY, dt);
      if (!p.holdStarted && still >= this.holdDelay) {
        this.engine.startHold(p.stillX, p.stillY);
        p.holdStarted = true;
      }
      this.flipCtx = 'hold';
      this.engine.tick(dt);
      this.flipCtx = 'stroke';
    }
    const busy = this.ink.frame(dt);
    if (p || busy) this.kick();
    else this.lastT = 0;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-calendar': HighlighterCalendar;
  }
  interface HTMLElementEventMap {
    monthchange: CustomEvent<{ month: string }>;
  }
}
