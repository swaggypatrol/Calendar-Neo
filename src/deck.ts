import type { HighlighterCalendar } from './calendar';
import type { Tool } from './engine';

/** 先加速再减速。 */
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const DURATION = 720;
/** 卡堆里每张卡露出来的偏移。 */
const STACK_DX = 1.2;
const STACK_DY = 3.2;

const pad2 = (n: number) => String(n).padStart(2, '0');

const STYLE = /* css */ `
:host {
  --hc-card-bg: #ffffff;
  --hc-card-edge: rgba(20, 30, 50, 0.16);
  --deck-gap: 20px;
  display: block;
}
@media (prefers-color-scheme: dark) {
  :host {
    --hc-card-bg: #1c1f24;
    --hc-card-edge: rgba(255, 255, 255, 0.16);
  }
}
.deck {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: var(--deck-gap);
  padding: 8px 8px 56px;
}
.deck:not(.spread) .side { display: none; }
highlighter-calendar {
  flex: none;
  position: relative;
  border-radius: 16px;
  background: var(--hc-card-bg);
}
.prev { z-index: 3; }
.center { z-index: 2; }
.next { z-index: 1; }
`;

interface YM {
  y: number;
  m0: number;
}

const addMonths = ({ y, m0 }: YM, n: number): YM => {
  const d = new Date(y, m0 + n, 1);
  return { y: d.getFullYear(), m0: d.getMonth() };
};
const ymKey = ({ y, m0 }: YM) => `${y}-${pad2(m0 + 1)}`;

/** 一张卡片下面叠着这一年剩下的月份：1 月下面 11 张，12 月就是最后一张。 */
function stackShadow(n: number): string {
  const parts: string[] = [];
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

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay'];

/**
 * <highlighter-deck>：一叠月份卡片。
 *
 * 平时只显示当前月，后面叠着今年剩下的月份。在卡片空白处双击、
 * 或按住往左 / 往右一划，下个月从卡堆里滑出、上个月从屏幕外飞进来，
 * 摊开成「上月 · 本月 · 下月」三张，都能直接涂选。
 * 摊开后左右划动按月翻，再双击空白处收回成一叠。
 * 三张卡共享同一份选择；属性和事件与 <highlighter-calendar> 相同，另有 spreadchange。
 */
export class HighlighterDeck extends HTMLElement {
  static observedAttributes = ['month', 'value', 'spread', ...FORWARDED];

  private $deck: HTMLElement;
  private cards: [HighlighterCalendar, HighlighterCalendar, HighlighterCalendar];
  private base: YM;
  private _spread = false;
  private animating = false;
  private selection: string[] = [];
  private swipe: { id: number; x: number; y: number; done: boolean } | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div class="deck" part="deck"></div>`;
    this.$deck = root.querySelector('.deck')!;
    const make = (cls: string) => {
      const c = document.createElement('highlighter-calendar');
      c.className = cls;
      this.$deck.append(c);
      return c;
    };
    this.cards = [make('prev side'), make('center'), make('next side')];
    const now = new Date();
    this.base = { y: now.getFullYear(), m0: now.getMonth() };

    for (const c of this.cards) {
      c.addEventListener('input', () => this.sync(c));
      c.addEventListener('change', () => this.sync(c));
      c.addEventListener('monthchange', () => this.onCardMonth(c));
    }
    this.$deck.addEventListener('dblclick', (e) => {
      if (this.isBlank(e)) this.toggle();
    });
    this.$deck.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$deck.addEventListener('pointermove', (e) => this.onMove(e));
    this.$deck.addEventListener('pointerup', () => (this.swipe = null));
    this.$deck.addEventListener('pointercancel', () => (this.swipe = null));
  }

  connectedCallback(): void {
    this.layout();
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
      if ((v !== null) !== this._spread) this.toggle(false);
    } else {
      for (const c of this.cards) {
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
    for (const c of this.cards) c.value = this.selection;
  }

  /** 中间那张（收起时唯一那张）的月份，YYYY-MM。 */
  get month(): string {
    return ymKey(this.base);
  }

  set month(v: string) {
    this.setAttribute('month', v);
  }

  get spread(): boolean {
    return this._spread;
  }

  set spread(on: boolean) {
    if (on !== this._spread) this.toggle();
  }

  get tool(): Tool {
    return this.cards[1].tool;
  }

  set tool(t: Tool) {
    for (const c of this.cards) c.tool = t;
  }

  get color(): string {
    return this.cards[1].color;
  }

  set color(v: string) {
    for (const c of this.cards) c.color = v;
  }

  get threshold(): number {
    return this.cards[1].threshold;
  }

  set threshold(n: number) {
    for (const c of this.cards) c.threshold = n;
  }

  clear(): void {
    const before = this.selection;
    if (!before.length) return;
    this.selection = [];
    for (const c of this.cards) c.clear(true);
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value: [], added: [], removed: before },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** 按月翻（摊开时三张一起移动）。 */
  shift(delta: number): void {
    if (this.animating || !delta) return;
    this.base = addMonths(this.base, delta);
    if (!this._spread) {
      this.layout();
      return;
    }
    const [prev, center, next] = this.cards;
    const pr = prev.getBoundingClientRect();
    const step = center.getBoundingClientRect().left - pr.left;
    this.layout();
    const d = Math.sign(delta);
    if (d > 0) {
      // 往后翻：三张左移一格，新的下个月从右边的卡堆里冒出来
      this.play([
        [prev, [{ transform: `translateX(${step}px)` }, { transform: 'none' }]],
        [center, [{ transform: `translateX(${step}px)` }, { transform: 'none' }]],
        [
          next,
          [
            { transform: `translate(${STACK_DX * 2}px, ${STACK_DY * 2}px) scale(0.97)`, opacity: 0.4 },
            { transform: 'none', opacity: 1 },
          ],
        ],
      ]);
    } else {
      // 往前翻：三张右移一格，新的上个月从屏幕外飞进来
      this.play([
        [prev, [{ transform: this.offscreenLeft(pr) }, { transform: 'none' }]],
        [center, [{ transform: `translateX(${-step}px)` }, { transform: 'none' }]],
        [next, [{ transform: `translateX(${-step}px)` }, { transform: 'none' }]],
      ]);
    }
  }

  // ---------- 内部 ----------

  private layout(): void {
    const months = [addMonths(this.base, -1), this.base, addMonths(this.base, 1)];
    this.cards.forEach((c, i) => {
      if (c.month !== ymKey(months[i])) c.setAttribute('month', ymKey(months[i]));
      c.toggleAttribute('hide-nav', this._spread);
    });
    // 卡堆永远在最右边那张下面
    const top = this._spread ? 2 : 1;
    this.cards.forEach((c, i) => {
      c.style.boxShadow = i === top ? stackShadow(11 - months[i].m0) : stackShadow(0);
    });
  }

  private sync(from: HighlighterCalendar): void {
    this.selection = from.value;
    for (const c of this.cards) if (c !== from) c.value = this.selection;
  }

  /** 卡片自己翻了月（收起时点箭头、键盘移出本月）：整叠跟着走。 */
  private onCardMonth(c: HighlighterCalendar): void {
    const i = this.cards.indexOf(c);
    const [y, m] = c.month.split('-').map(Number);
    this.base = addMonths({ y, m0: m - 1 }, 1 - i);
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
    if (!this.isBlank(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
  }

  private onMove(e: PointerEvent): void {
    const s = this.swipe;
    if (!s || s.id !== e.pointerId || s.done) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    s.done = true;
    if (!this._spread) this.toggle();
    else this.shift(dx < 0 ? 1 : -1);
  }

  private offscreenLeft(r: DOMRect): string {
    return `translate(${-(r.right + 80)}px, -40px) rotate(-12deg)`;
  }

  private toggle(animate = true): void {
    if (this.animating) return;
    const [prev, center, next] = this.cards;
    const first = center.getBoundingClientRect();
    const opening = !this._spread;

    if (opening) {
      this._spread = true;
      this.$deck.classList.add('spread');
      this.layout();
      if (animate) {
        const c = center.getBoundingClientRect();
        const n = next.getBoundingClientRect();
        const p = prev.getBoundingClientRect();
        this.play([
          [center, [{ transform: `translate(${first.left - c.left}px, ${first.top - c.top}px)` }, { transform: 'none' }]],
          // 下个月从本月下面的卡堆里滑出来
          [
            next,
            [
              { transform: `translate(${first.left - n.left + STACK_DX}px, ${first.top - n.top + STACK_DY}px)` },
              { transform: 'none' },
            ],
          ],
          // 上个月从屏幕外飞进来
          [prev, [{ transform: this.offscreenLeft(p) }, { transform: 'none' }], 90],
        ]);
      }
    } else {
      this._spread = false;
      // 先量出收起后本月的位置，再倒着播放
      this.$deck.classList.remove('spread');
      const target = center.getBoundingClientRect();
      this.$deck.classList.add('spread');
      const c = first;
      const n = next.getBoundingClientRect();
      const p = prev.getBoundingClientRect();
      center.style.boxShadow = stackShadow(11 - this.base.m0);
      next.style.boxShadow = stackShadow(0);
      const finish = () => {
        this.$deck.classList.remove('spread');
        this.layout();
      };
      if (!animate) finish();
      else
        this.play(
          [
            [center, [{ transform: 'none' }, { transform: `translate(${target.left - c.left}px, ${target.top - c.top}px)` }]],
            [
              next,
              [
                { transform: 'none' },
                { transform: `translate(${target.left - n.left + STACK_DX}px, ${target.top - n.top + STACK_DY}px)` },
              ],
            ],
            [prev, [{ transform: 'none' }, { transform: this.offscreenLeft(p) }]],
          ],
          finish,
        );
    }
    this.toggleAttribute('spread', this._spread);
    this.dispatchEvent(new CustomEvent('spreadchange', { detail: { spread: this._spread }, bubbles: true, composed: true }));
  }

  private play(items: [HTMLElement, Keyframe[], number?][], done?: () => void): void {
    this.animating = true;
    const anims = items.map(([el, frames, delay = 0]) =>
      el.animate(frames, { duration: DURATION, delay, easing: EASE, fill: 'both' }),
    );
    Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
      done?.();
      for (const a of anims) a.cancel();
      this.animating = false;
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-deck': HighlighterDeck;
  }
}
