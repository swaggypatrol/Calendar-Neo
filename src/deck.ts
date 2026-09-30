import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';

/** 先加速再减速。 */
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const DURATION = 720;
/** 卡堆里每张卡露出来的偏移。 */
const STACK_DX = 1.2;
const STACK_DY = 3.2;

/** 左 / 中 / 右三个位置，外加一张备用卡（翻月时轮换用）。 */
type Role = 'L' | 'C' | 'R' | 'S';
const ROLES: Role[] = ['L', 'C', 'R', 'S'];
const OFFSET: Record<Role, number> = { L: -1, C: 0, R: 1, S: 0 };
const Z: Record<Role, number> = { L: 3, C: 2, R: 1, S: 0 };

interface YM {
  y: number;
  m0: number;
}

interface Pos {
  x: number;
  y: number;
}

/** 一张卡在一次动画里的变化；没有 from/to 时只改层级和阴影。 */
interface Move {
  el: HighlighterCalendar;
  from?: Pos;
  to?: Pos;
  z?: number;
  shadow?: string;
  delay?: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const addMonths = ({ y, m0 }: YM, n: number): YM => {
  const d = new Date(y, m0 + n, 1);
  return { y: d.getFullYear(), m0: d.getMonth() };
};
const ymKey = ({ y, m0 }: YM) => `${y}-${pad2(m0 + 1)}`;
const tf = ({ x, y }: Pos) => `translate(${x}px, ${y}px)`;

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
}
highlighter-calendar {
  grid-area: 1 / 1;
  width: var(--hc-card-width);
  border-radius: 16px;
  background: var(--hc-card-bg);
  touch-action: pan-y;
  will-change: transform;
}
highlighter-calendar.hidden {
  visibility: hidden;
  pointer-events: none;
}
.deck.busy highlighter-calendar { pointer-events: none; }
`;

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay'];

/**
 * <highlighter-deck>：一叠月份卡片。
 *
 * 平时只显示当前月，下面叠着今年剩下的月份。在卡片空白处：
 * - 往右划：下个月从卡堆里滑出来，摆到右边；
 * - 往左划：上个月从屏幕左边外面飞进来（像从反方向一个看不见的卡堆里出来），摆到左边；
 * - 左右都摆开以后继续划：整排平移一个月，最左那张飞出屏幕，最右那张退回卡堆；
 * - 双击：一次摊开左中右三个月，或者收回成一叠。
 * 所有卡片共享同一份选择；属性和 input / change 事件与 <highlighter-calendar> 相同。
 */
export class HighlighterDeck extends HTMLElement {
  static observedAttributes = ['month', 'value', 'spread', ...FORWARDED];

  private $deck: HTMLElement;
  private pool: HighlighterCalendar[] = [];
  private roles: Record<Role, HighlighterCalendar>;
  private base: YM;
  private showL = false;
  private showR = false;
  private busy = false;
  private selection: string[] = [];
  private swipe: { id: number; x: number; y: number; done: boolean } | null = null;
  private ro: ResizeObserver | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div class="deck" part="deck"></div>`;
    this.$deck = root.querySelector('.deck')!;
    for (let i = 0; i < ROLES.length; i++) {
      const c = document.createElement('highlighter-calendar');
      c.addEventListener('input', () => this.sync(c));
      c.addEventListener('change', () => this.sync(c));
      c.addEventListener('monthchange', (e) => {
        e.stopPropagation();
        this.onCardMonth(c);
      });
      this.$deck.append(c);
      this.pool.push(c);
    }
    const [l, c, r, s] = this.pool;
    this.roles = { L: l, C: c, R: r, S: s };
    const now = new Date();
    this.base = { y: now.getFullYear(), m0: now.getMonth() };

    this.$deck.addEventListener('dblclick', (e) => {
      if (!this.busy && this.isBlank(e)) this.spread = !this.spread;
    });
    this.$deck.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$deck.addEventListener('pointermove', (e) => this.onMove(e));
    this.$deck.addEventListener('pointerup', () => (this.swipe = null));
    this.$deck.addEventListener('pointercancel', () => (this.swipe = null));
  }

  connectedCallback(): void {
    this.layout();
    this.ro = new ResizeObserver(() => this.place());
    this.ro.observe(this.$deck);
  }

  disconnectedCallback(): void {
    this.ro?.disconnect();
    this.ro = null;
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    if (name === 'month') {
      const m = v && /^(\d{4})-(\d{1,2})$/.exec(v);
      if (m) {
        this.base = { y: Number(m[1]), m0: Math.min(11, Math.max(0, Number(m[2]) - 1)) };
        this.layout();
      }
    } else if (name === 'value') {
      this.value = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (name === 'spread') {
      // 只作为初始状态：一开始就摊开三个月
      this.showL = this.showR = v !== null;
      this.layout();
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
    return ymKey(this.base);
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  /** 是否摊开了（左右至少有一张）。设为 true 一次摊开三个月，false 收回成一叠。 */
  get spread(): boolean {
    return this.showL || this.showR;
  }

  set spread(on: boolean) {
    if (this.busy) return;
    if (on) this.spreadAll();
    else this.collapse();
  }

  get tool(): Tool {
    return this.roles.C.tool;
  }

  set tool(t: Tool) {
    for (const c of this.pool) c.tool = t;
  }

  get color(): string {
    return this.roles.C.color;
  }

  set color(v: string) {
    for (const c of this.pool) c.color = v;
  }

  get threshold(): number {
    return this.roles.C.threshold;
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

  /** 等同于在空白处往右划：从卡堆里摊出下个月；右边已经有了就整排往后翻一个月。 */
  next(): void {
    if (this.busy) return;
    if (!this.showR) this.reveal('R');
    else this.advance();
  }

  /** 等同于在空白处往左划：从屏幕外飞进上个月；左边已经有了就整排往前翻一个月。 */
  prev(): void {
    if (this.busy) return;
    if (!this.showL) this.reveal('L');
    else this.back();
  }

  // ---------- 摆放 ----------

  private ymOf(role: Role): YM {
    return addMonths(this.base, OFFSET[role]);
  }

  /** 这张卡下面还叠着今年的几个月。 */
  private pile(ym: YM): number {
    return 11 - ym.m0;
  }

  private get step(): number {
    const gap = parseFloat(getComputedStyle(this).getPropertyValue('--deck-gap')) || 20;
    return this.roles.C.offsetWidth + gap;
  }

  /** 屏幕左边外面：那个看不见的、反方向的卡堆。 */
  private offLeft(): Pos {
    const r = this.roles.C.getBoundingClientRect();
    return { x: -(r.left + r.width + 40), y: STACK_DY };
  }

  private layout(): void {
    for (const role of ['L', 'C', 'R'] as const) {
      const c = this.roles[role];
      const key = ymKey(this.ymOf(role));
      if (c.month !== key) c.setAttribute('month', key);
    }
    this.setNav(!this.spread);
    this.place();
  }

  /** 按当前状态摆好每张卡：位置、层级、显隐，卡堆永远在最右边那张下面。 */
  private place(): void {
    if (this.busy) return;
    const s = this.step;
    const top: Role = this.showR ? 'R' : 'C';
    const pos: Record<Role, Pos> = {
      L: { x: -s, y: 0 },
      C: { x: 0, y: 0 },
      R: { x: s, y: 0 },
      S: { x: s + STACK_DX, y: STACK_DY },
    };
    for (const role of ROLES) {
      const c = this.roles[role];
      const visible = role === 'C' || (role === 'L' && this.showL) || (role === 'R' && this.showR);
      c.classList.toggle('hidden', !visible);
      c.style.transform = tf(pos[role]);
      c.style.zIndex = String(Z[role]);
      c.style.boxShadow = stackShadow(role === top ? this.pile(this.ymOf(role)) : 0);
    }
  }

  /** 收起时中间那张可以用箭头翻月；摊开后改用左右划。 */
  private setNav(show: boolean): void {
    for (const c of this.pool) c.toggleAttribute('hide-nav', !show);
  }

  // ---------- 动画 ----------

  private revealRMoves(): Move[] {
    const { C, R } = this.roles;
    return [
      // 卡堆跟着下个月一起从本月下面滑出去
      { el: C, shadow: stackShadow(0) },
      {
        el: R,
        from: { x: STACK_DX, y: STACK_DY },
        to: { x: this.step, y: 0 },
        z: 1,
        shadow: stackShadow(this.pile(this.ymOf('R'))),
      },
    ];
  }

  private hideRMoves(): Move[] {
    return [{ el: this.roles.R, from: { x: this.step, y: 0 }, to: { x: STACK_DX, y: STACK_DY }, z: 1 }];
  }

  private revealLMoves(delay = 0): Move[] {
    return [{ el: this.roles.L, from: this.offLeft(), to: { x: -this.step, y: 0 }, z: 4, delay }];
  }

  private hideLMoves(): Move[] {
    return [{ el: this.roles.L, from: { x: -this.step, y: 0 }, to: this.offLeft(), z: 4 }];
  }

  private reveal(side: 'L' | 'R'): void {
    this.setNav(false);
    this.run(side === 'R' ? this.revealRMoves() : this.revealLMoves(), 'spreadchange', () => {
      if (side === 'R') this.showR = true;
      else this.showL = true;
    });
  }

  private spreadAll(): void {
    const moves = [
      ...(this.showR ? [] : this.revealRMoves()),
      ...(this.showL ? [] : this.revealLMoves(this.showR ? 0 : 90)),
    ];
    if (!moves.length) return;
    this.setNav(false);
    this.run(moves, 'spreadchange', () => {
      this.showL = this.showR = true;
    });
  }

  private collapse(): void {
    const moves = [...(this.showR ? this.hideRMoves() : []), ...(this.showL ? this.hideLMoves() : [])];
    if (!moves.length) return;
    this.run(moves, 'spreadchange', () => {
      this.showL = this.showR = false;
    });
  }

  /** 往后翻：最左那张飞出屏幕，整排左移，新的下个月从右边卡堆里浮上来。 */
  private advance(): void {
    const { L, C, R, S } = this.roles;
    const s = this.step;
    const incoming = addMonths(this.base, 2);
    S.setAttribute('month', ymKey(incoming));
    this.setNav(false);
    const moves: Move[] = [
      { el: C, from: { x: 0, y: 0 }, to: { x: -s, y: 0 }, z: 3, shadow: stackShadow(0) },
      { el: R, from: { x: s, y: 0 }, to: { x: 0, y: 0 }, z: 2, shadow: stackShadow(0) },
      {
        el: S,
        from: { x: s + STACK_DX, y: STACK_DY },
        to: { x: s, y: 0 },
        z: 1,
        shadow: stackShadow(this.pile(incoming)),
      },
    ];
    if (this.showL) moves.push({ el: L, from: { x: -s, y: 0 }, to: this.offLeft(), z: 4 });
    this.run(moves, 'monthchange', () => {
      this.base = addMonths(this.base, 1);
      this.roles = { L: C, C: R, R: S, S: L };
      this.showL = this.showR = true;
    });
  }

  /** 往前翻：整排右移，最右那张退回卡堆，新的上个月从屏幕外飞进来。 */
  private back(): void {
    const { L, C, R, S } = this.roles;
    const s = this.step;
    const incoming = addMonths(this.base, -2);
    S.setAttribute('month', ymKey(incoming));
    this.setNav(false);
    const moves: Move[] = [
      { el: S, from: this.offLeft(), to: { x: -s, y: 0 }, z: 4 },
      { el: L, from: { x: -s, y: 0 }, to: { x: 0, y: 0 }, z: 3 },
    ];
    if (this.showR) {
      // 右边那张往卡堆里一沉，本月滑过去盖在上面
      moves.push({ el: R, from: { x: s, y: 0 }, to: { x: s + STACK_DX, y: STACK_DY }, z: 1 });
      moves.push({ el: C, from: { x: 0, y: 0 }, to: { x: s, y: 0 }, z: 2, shadow: stackShadow(0) });
    } else {
      // 本月就是卡堆最上面那张，带着卡堆一起右移
      moves.push({ el: C, from: { x: 0, y: 0 }, to: { x: s, y: 0 }, z: 2 });
    }
    this.run(moves, 'monthchange', () => {
      this.base = addMonths(this.base, -1);
      this.roles = { L: S, C: L, R: C, S: R };
      this.showL = this.showR = true;
    });
  }

  private run(moves: Move[], event: 'spreadchange' | 'monthchange', commit: () => void): void {
    this.busy = true;
    this.$deck.classList.add('busy');
    const anims: Animation[] = [];
    for (const m of moves) {
      m.el.classList.remove('hidden');
      if (m.z !== undefined) m.el.style.zIndex = String(m.z);
      if (m.shadow !== undefined) m.el.style.boxShadow = m.shadow;
      if (!m.from || !m.to) continue;
      anims.push(
        m.el.animate([{ transform: tf(m.from) }, { transform: tf(m.to) }], {
          duration: DURATION,
          delay: m.delay ?? 0,
          easing: EASE,
          fill: 'both',
        }),
      );
    }
    Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
      commit();
      this.busy = false;
      this.layout();
      for (const a of anims) a.cancel();
      this.$deck.classList.remove('busy');
      const detail =
        event === 'monthchange' ? { month: this.month } : { spread: this.spread, left: this.showL, right: this.showR };
      this.dispatchEvent(new CustomEvent(event, { detail, bubbles: true, composed: true }));
    });
  }

  // ---------- 选择与手势 ----------

  private sync(from: HighlighterCalendar): void {
    this.selection = from.value;
    for (const c of this.pool) if (c !== from) c.value = this.selection;
  }

  /** 卡片自己翻了月（收起时点箭头、键盘移出本月）：整叠跟着走。 */
  private onCardMonth(c: HighlighterCalendar): void {
    const role = ROLES.find((r) => this.roles[r] === c);
    if (!role || role === 'S') return;
    const [y, m] = c.month.split('-').map(Number);
    this.base = addMonths({ y, m0: m - 1 }, -OFFSET[role]);
    this.layout();
    this.dispatchEvent(new CustomEvent('monthchange', { detail: { month: this.month }, bubbles: true, composed: true }));
  }

  /** 卡片上的空白处：不在日期格子里、也不是按钮。 */
  private isBlank(e: Event): boolean {
    const path = e.composedPath() as Element[];
    if (!path.some((n) => n instanceof HTMLElement && n.localName === 'highlighter-calendar')) return false;
    return !path.some((n) => n instanceof HTMLElement && (n.classList.contains('wrap') || n.localName === 'button'));
  }

  private onDown(e: PointerEvent): void {
    if (this.busy || !this.isBlank(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
  }

  private onMove(e: PointerEvent): void {
    const s = this.swipe;
    if (!s || s.id !== e.pointerId || s.done) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    s.done = true;
    // 往右划出下个月，往左划出上个月
    if (dx > 0) this.next();
    else this.prev();
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
