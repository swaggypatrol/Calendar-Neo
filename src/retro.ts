import { monthIndexOf } from './range';
import { SLOTS, firstMonthShowing, keyOf, monthSlots, pairLayout } from './keypad';
import { MINCHO, RetroShell } from './retro-shell';

/** What only the day keys need on top of the calculator's look: the weekday lamps, the day grid, the day colours and the today lamp. */
const DAY_STYLE = /* css */ `
/* ---------- The days of the week, each a lamp that lights over the chosen day's column ---------- */
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
  margin: calc(var(--g) * 1.618) 0 calc(var(--g) * 0.618);
  color: var(--print);
  font-family: ${MINCHO};
  font-size: calc(3.1 * var(--u));
  font-weight: 600;
  line-height: 1;
  transition: opacity 0.3s ease var(--plate, 0s);
}
/* Unlit, just the print, Sunday red and Saturday blue as a Japanese calendar has them. Lit, a small smoked window
   with the letter glowing in it like a filament: it heats fast and cools slowly, so moving to another column the old
   lamp glows down rather than blinking out */
.week span {
  justify-self: center;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-width: calc(var(--kw) * 0.618);
  height: calc(var(--g) * 2.618);
  padding: 0 calc(0.8 * var(--u));
  border-radius: 999px;
  background-color: transparent;
  transition:
    color 0.55s cubic-bezier(0.2, 0.6, 0.3, 1),
    background-color 0.55s cubic-bezier(0.2, 0.6, 0.3, 1),
    box-shadow 0.55s cubic-bezier(0.2, 0.6, 0.3, 1),
    text-shadow 0.55s cubic-bezier(0.2, 0.6, 0.3, 1);
}
.week .sun { color: var(--sun); }
.week .sat { color: var(--sat); }
.week span.lit {
  color: #ffe9a0;
  background-color: var(--lamp-window);
  text-shadow: 0 0 calc(0.45 * var(--u)) #ffc915, 0 0 calc(1.3 * var(--u)) rgba(255, 190, 13, 0.8);
  box-shadow: inset 0 calc(0.25 * var(--u)) calc(0.6 * var(--u)) rgba(0, 0, 0, 0.55), 0 0 calc(1.4 * var(--u)) rgba(255, 190, 13, 0.35);
  transition-duration: 0.16s;
}

.pad {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--g);
}
.away .week { opacity: 0; }
.folded .week { opacity: 0; }
.key.sun { color: var(--sun); }
.key.sat { color: var(--sat); }
.key.past { color: var(--muted); }
.key.latched.sun, .key.latched.sat, .key.latched.past { color: var(--ink); }

/* ---------- Two months: one above the other, or side by side, under the one top row ---------- */
.cap { display: none; }
.duo .cap {
  display: block;
  margin: calc(var(--g) * 1.618) 0 0;
  color: var(--legend);
  font-family: ${MINCHO};
  font-size: calc(3.4 * var(--u));
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 1.2;
  text-align: center;
}
.duo .pair { display: grid; gap: var(--pad); }
.duo-side .pair { grid-template-columns: 1fr 1fr; }
/* Side by side, the body is two calculators' widths less one margin: the keys keep their size */
.shell.duo-side { --u: calc(100cqi / 194.764); }
.duo-side .fn { grid-template-columns: var(--slot-w) 1fr var(--slot-w) var(--slot-w); }
.duo-side .title { grid-column: auto; }
:host([data-layout="side"]) { width: calc(var(--rc-width) * 1.94764); }
/* The month keys keep their one-month size, over the first month's place (sized from it when laid out) */
.duo .months { inset: 0 auto auto 50%; transform: translateX(-50%); }
`;

/** One month's block on the board: its name (shown when there are two), the weekday lamps, and its 42 keys. */
const DAYS_BLOCK = `<div class="days"><div class="cap" aria-hidden="true"></div><div class="week" aria-hidden="true"></div><div class="pad" role="radiogroup"></div></div>`;

interface SlotState {
  key: string | null;
  label: string;
  cls: string[];
}

const toDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

/**
 * <retro-calendar>: a single-date picker built like an old desk calculator. Every day is a key, and the keys interlock
 * like the station buttons of an old radio: press one and it latches down, and whichever key was down springs back up;
 * press the one that is down again and it springs up too, leaving no date. A lamp over the chosen day's column lights
 * up. The month at the top opens a pad of twelve month keys (the arrows then turn the year). The body is liquid glass
 * and the keys frosted glass, every corner continuous (G2) and every proportion golden.
 *
 * With months="2" it shows two neighbouring months in the one body, under one pair of arrows and one Today key: the
 * arrows move both a month at a time, and any day of either can be the one chosen. On a screen taller than it is wide
 * the two stand one above the other, otherwise side by side (as <highlighter-picker> lays out its book).
 *
 * Attributes: value="2026-10-14"  month="2026-10"  min="today"  max="+90"  week-start="0|1"  months="1|2"
 *             locale="ja-JP"  theme="light|dark"
 * Events: change (detail: { value }), monthchange (detail: { month, reason })
 */
export class RetroCalendar extends RetroShell {
  static observedAttributes = ['value', 'month', 'min', 'max', 'week-start', 'locale', 'theme', 'months'];

  private $blocks: HTMLElement[] = [];
  /** The two months' blocks together (made the first time the calendar shows two). */
  private $pair: HTMLElement | null = null;
  private keys: HTMLButtonElement[] = [];
  private _value: string | null = null;
  private weekStart = 0;
  private pads = 1;
  private slots: SlotState[] = [];
  private focusIdx = -1;
  private onScreen = () => this.layout();

  constructor() {
    super(DAY_STYLE, DAYS_BLOCK);
    this.addBlock(this.shadowRoot!.querySelector('.days') as HTMLElement);
  }

  /** Wire a month's block and give it its 42 keys. */
  private addBlock(block: HTMLElement): void {
    const pad = block.querySelector('.pad') as HTMLElement;
    const first = this.keys.length;
    for (let i = 0; i < SLOTS; i++) this.keys.push(this.addKey(pad, 'key blank', { i: String(first + i) }));
    this.listenPad(pad);
    this.$blocks.push(block);
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.pads > 1) window.addEventListener('resize', this.onScreen);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.onScreen);
  }

  attributeChangedCallback(name: string, old: string | null, v: string | null): void {
    switch (name) {
      case 'value':
        this.value = v;
        break;
      case 'week-start':
        this.weekStart = v === null ? 0 : ((Number(v) % 7) + 7) % 7 || 0;
        if (this.rendered) this.render(0);
        break;
      case 'months':
        this.setPads(v === '2' ? 2 : 1);
        break;
      default:
        super.attributeChangedCallback(name, old, v);
    }
  }

  // ---------- Public API ----------

  /** The chosen date (YYYY-MM-DD), or null. Only ever one. */
  get value(): string | null {
    return this._value;
  }

  set value(v: string | null) {
    const key = v && /^\d{4}-\d{2}-\d{2}$/.test(v) && this.range.allows(v) ? v : null;
    if (key === this._value) return;
    this._value = key;
    if (key && !this.isShown(monthIndexOf(key)) && !(this.hasAttribute('month') && !this.rendered)) this.goto(monthIndexOf(key), true, 'value');
    this.sync();
  }

  /** How many months are on the board: 1, or 2 side by side / one above the other. */
  get months(): number {
    return this.pads;
  }

  set months(n: number) {
    this.setAttribute('months', String(n === 2 ? 2 : 1));
  }

  /** Release the key that is down. */
  clear(): void {
    this.choose(null);
  }

  /** Focus goes to the key the keyboard would start from: the one that is down, or today, or this month. */
  focus(options?: FocusOptions): void {
    const el = this._view === 'months' ? this.mkeys[this.mFocus] : this.keys[this.focusIdx];
    if (el) el.focus(options);
    else HTMLElement.prototype.focus.call(this, options);
  }

  // ---------- Two months ----------

  private setPads(n: number): void {
    if (n === this.pads) return;
    this.pads = n;
    if (n > 1 && !this.$pair) {
      const pair = document.createElement('div');
      pair.className = 'pair';
      this.$blocks[0].before(pair);
      const tmp = document.createElement('template');
      tmp.innerHTML = DAYS_BLOCK;
      const block = tmp.content.firstElementChild as HTMLElement;
      pair.append(this.$blocks[0], block);
      this.addBlock(block);
      this.$pair = pair;
    }
    this.$blocks.slice(1).forEach((b) => (b.hidden = n < 2));
    this.$shell.classList.toggle('duo', n > 1);
    if (n > 1 && this.isConnected) window.addEventListener('resize', this.onScreen);
    else window.removeEventListener('resize', this.onScreen);
    this.layout();
    // The second month's keys come up with the first; hidden ones stay down
    for (const k of this.keys.slice(SLOTS)) k.classList.toggle('stow', n < 2 || this._view !== 'days' || this.folded);
    if (this.rendered) {
      this.monthIdx = this.clampMonth(this.monthIdx);
      this.render(0);
    }
  }

  /** Two months: one above the other on a screen taller than it is wide, side by side otherwise (read from the window now). */
  layout(): void {
    const side = this.pads > 1 && pairLayout(window.innerWidth, window.innerHeight) === 'side';
    this.$shell.classList.toggle('duo-side', side);
    this.$shell.classList.toggle('duo-stack', this.pads > 1 && !side);
    if (this.pads > 1) this.dataset.layout = side ? 'side' : 'stack';
    else delete this.dataset.layout;
  }

  private isShown(k: number): boolean {
    return k >= this.monthIdx && k < this.monthIdx + this.pads;
  }

  // ---------- What the body supplies ----------

  protected bodyView(): HTMLElement {
    // (one month's block is its own view, as it always was; two share their pair)
    return this.$pair ?? this.$blocks[0];
  }

  protected bodyKeys(): HTMLButtonElement[] {
    return this.keys.slice(0, SLOTS * this.pads);
  }

  protected monthsShown(): number {
    return this.pads;
  }

  protected glassKey(): HTMLElement {
    return this.keys[0];
  }

  protected bodyRow(el: HTMLElement): number {
    const i = Number(el.dataset.i);
    const block = Math.floor(i / SLOTS);
    // Rows count down the board: the second month below the first adds its six rows
    return 1 + Math.floor((i % SLOTS) / 7) + (this.$shell.classList.contains('duo-stack') ? block * 6 : 0);
  }

  protected beforeShape(): void {
    if (this.pads < 2) {
      this.$months.style.removeProperty('width');
      this.$months.style.removeProperty('height');
      return;
    }
    // Over two months the month keys keep the size they have over one, over the first month's place
    const first = this.$blocks[0];
    this.$months.style.width = `${first.offsetWidth}px`;
    this.$months.style.height = `${first.offsetHeight}px`;
  }

  protected rangeApplied(): void {
    if (this._value && !this.range.allows(this._value)) this.choose(null);
  }

  protected pressed(el: HTMLButtonElement): void {
    if (el.dataset.i) this.focusIdx = Number(el.dataset.i);
    super.pressed(el);
  }

  protected afterCancel(): void {
    this.sync();
  }

  /** A day key comes up: it latches (and throws out the old one), or, if it was the one already down, lets go. */
  protected releaseBody(el: HTMLButtonElement): void {
    const key = el.dataset.key || null;
    if (!key) return;
    if (key === this._value) {
      this.choose(null);
      return;
    }
    el.classList.add('latched');
    this.choose(key, 45);
  }

  protected titleText(): string {
    if (this._view === 'months' || this.pads < 2) return super.titleText();
    const a = new Date(Math.floor(this.monthIdx / 12), this.monthIdx % 12, 1);
    // Short month names where the language has them (Oct, not 10月), so the range fits one month's width; each month's
    // caption has the full name
    const month = (style: 'short' | 'long', d: Date) => new Intl.DateTimeFormat(this.locale, { month: style }).format(d);
    const style = /\d/.test(month('short', a)) ? 'long' : 'short';
    const fmt = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: style });
    const b = new Date(Math.floor((this.monthIdx + 1) / 12), (this.monthIdx + 1) % 12, 1);
    const range = typeof fmt.formatRange === 'function' ? fmt.formatRange(a, b) : '';
    // Where the language's range comes out as bare numbers (2026/10～2026/11 in Japanese), it is spelt out as one month is
    if (/\p{L}/u.test(range)) return range;
    return `${fmt.format(a)} – ${a.getFullYear() === b.getFullYear() ? month(style, b) : fmt.format(b)}`;
  }

  // ---------- Selection ----------

  /** A key was pressed home: it latches, and the interlock throws out whichever key was down before. */
  private choose(key: string | null, popDelay = 0): void {
    if (key === this._value) return;
    this._value = key;
    this.sync(popDelay);
    if (key && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(6);
    this.dispatchEvent(new CustomEvent('change', { detail: { value: key }, bubbles: true, composed: true }));
  }

  // ---------- Drawing ----------

  /** Lay the months out on the keys. dir is -1 / 1 when turning to an earlier / later month, 0 for no animation. */
  protected render(dir: number): void {
    this.range.refresh();
    const now = new Date();
    const today = keyOf(now.getFullYear(), now.getMonth(), now.getDate());

    if (this._view === 'days') this.roll(this.$roll, this.titleText(), dir);
    else this.renderMonths(0);
    // The weekday heads in the reader's own letters: S M T W T F S, 日 月 火 水 木 金 土, 日 一 二 三 四 五 六
    const narrow = new Intl.DateTimeFormat(this.locale, { weekday: 'narrow' });
    let heads = '';
    for (let i = 0; i < 7; i++) {
      const n = (this.weekStart + i) % 7;
      // 2023-01-01 was a Sunday
      heads += `<span class="${n === 0 ? 'sun' : n === 6 ? 'sat' : ''}" data-wd="${n}">${narrow.format(new Date(2023, 0, 1 + n))}</span>`;
    }
    const monthName = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long' });
    this.$blocks.slice(0, this.pads).forEach((block, p) => {
      const week = block.querySelector('.week') as HTMLElement;
      if (week.dataset.sig !== heads) {
        week.innerHTML = heads;
        week.dataset.sig = heads;
      }
      const k = this.monthIdx + p;
      const name = monthName.format(new Date(Math.floor(k / 12), k % 12, 1));
      (block.querySelector('.cap') as HTMLElement).textContent = name;
      block.querySelector('.pad')!.setAttribute('aria-label', name);
    });
    this.updateFn();

    const label = new Intl.DateTimeFormat(this.locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const prev = this.slots;
    this.slots = [];
    for (let p = 0; p < this.pads; p++) {
      const k = this.monthIdx + p;
      const y = Math.floor(k / 12);
      const m0 = k % 12;
      monthSlots(y, m0, this.weekStart).forEach((d, i) => {
        if (d === null) {
          this.slots.push({ key: null, label: '', cls: ['blank'] });
          return;
        }
        const key = keyOf(y, m0, d);
        const wdN = (this.weekStart + i) % 7;
        const cls: string[] = [];
        if (wdN === 0) cls.push('sun');
        if (wdN === 6) cls.push('sat');
        if (key < today) cls.push('past');
        if (key === today) cls.push('today');
        if (!this.range.allows(key)) cls.push('off');
        this.slots.push({ key, label: String(d), cls });
      });
    }

    this.slots.forEach((s, i) => {
      const el = this.keys[i];
      const legend = el.querySelector('.legend') as HTMLElement;
      el.dataset.key = s.key ?? '';
      el.setAttribute('aria-label', s.key ? label.format(toDate(s.key)) : '');
      el.setAttribute('aria-disabled', String(!s.key || s.cls.includes('off')));
      const was = prev[i];
      const paint = () => {
        legend.textContent = s.label;
        for (const c of ['sun', 'sat', 'past', 'today', 'off']) el.classList.toggle(c, s.cls.includes(c));
      };
      // Blank keys sink flush, new ones rise out of the plate; keys that stay up roll their legends like a drum
      el.classList.toggle('blank', !s.key);
      for (const a of legend.getAnimations()) a.cancel();
      if (!dir || !was || !was.key || !s.key || was.label === s.label) {
        if (s.key || !dir) paint();
        else setTimeout(() => this.slots[i] === s && paint(), 320);
        return;
      }
      const j = i % SLOTS;
      this.rollLegend(legend, dir, (dir > 0 ? j : SLOTS - 1 - j) * 5, paint);
    });
    this.rendered = true;
    this.sync();
  }

  /** Bring the keys, the weekday lamp and the readout in line with the value. */
  private sync(popDelay = 0): void {
    if (!this.rendered) return;
    const v = this._value;
    let latchedIdx = -1;
    this.bodyKeys().forEach((el, i) => {
      const on = !!v && this.slots[i]?.key === v;
      if (on) latchedIdx = i;
      el.setAttribute('aria-checked', String(on));
      if (el === this.press?.el) return;
      if (on) el.classList.add('latched');
      else if (el.classList.contains('latched')) {
        // When thrown out by another key, the interlock bar trips a beat after the new key passes the catch
        if (popDelay) setTimeout(() => el.getAttribute('aria-checked') === 'false' && el.classList.remove('latched'), popDelay);
        else el.classList.remove('latched');
      }
    });
    if (latchedIdx >= 0) this.focusIdx = latchedIdx;
    this.syncFocus();
    // The lamp over the chosen day's column, lit in the month that day is in while it is on the keys
    const lit = latchedIdx >= 0 ? Math.floor(latchedIdx / SLOTS) : -1;
    const wd = latchedIdx >= 0 ? (this.weekStart + (latchedIdx % SLOTS)) % 7 : -1;
    this.$blocks.forEach((block, p) => {
      for (const s of block.querySelector('.week')!.children) s.classList.toggle('lit', p === lit && Number((s as HTMLElement).dataset.wd) === wd);
    });
    this.$readout.textContent = v ? new Intl.DateTimeFormat(this.locale, { dateStyle: 'full' }).format(toDate(v)) : this.words().none;
  }

  /** One key in each pad takes the Tab key: the one that is down, else today (on the board), else the first there is. */
  protected syncFocus(): void {
    const keys = this.bodyKeys();
    if (this.focusIdx < 0 || this.focusIdx >= keys.length || !this.slots[this.focusIdx]?.key) {
      const latched = keys.findIndex((k) => k.classList.contains('latched'));
      const today = keys.findIndex((k) => k.classList.contains('today'));
      this.focusIdx = latched >= 0 ? latched : today >= 0 ? today : this.slots.findIndex((s) => s.key);
    }
    this.keys.forEach((el, i) => (el.tabIndex = this._view === 'days' && i === this.focusIdx ? 0 : -1));
    super.syncFocus();
  }

  // ---------- Input ----------

  /** Arrow keys walk the keys (across into the next or previous month at the edges); Enter / Space press one. */
  protected onBodyKey(e: KeyboardEvent): void {
    const el = (e.target as Element).closest<HTMLButtonElement>('.key');
    if (!el || el.dataset.i === undefined) return;
    if (e.key === 'Enter' || e.key === ' ') return this.pressKey(e, el);
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      this.goto(this.monthIdx + (e.key === 'PageUp' ? -1 : 1), true, 'keyboard');
      this.focusKey(this.focusIdx);
      return;
    }
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    const from = this.slots[Number(el.dataset.i)].key!;
    const d = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)) + step);
    const target = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
    const k = d.getFullYear() * 12 + d.getMonth();
    const first = firstMonthShowing(k, this.monthIdx, this.pads);
    if (first !== this.monthIdx) {
      if (this.clampMonth(first) !== first) return;
      this.goto(first, true, 'keyboard');
    }
    this.focusKey(this.slots.findIndex((s) => s.key === target));
  }

  private focusKey(i: number): void {
    if (i < 0 || !this.slots[i]?.key) i = this.slots.findIndex((s) => s.key);
    this.focusIdx = i;
    this.keys.forEach((el, j) => (el.tabIndex = j === i ? 0 : -1));
    this.keys[i]?.focus({ preventScroll: true });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'retro-calendar': RetroCalendar;
  }
}
