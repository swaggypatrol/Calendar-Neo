import type { CalendarChangeDetail } from './calendar';
import type { HighlighterBook } from './book';
import type { Tool } from './engine';

/** Ease in then out; the same curve as the card deck. */
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const OPEN_MS = 560;
/** Narrower than this, the calendar opens over the whole screen instead of under the field (the book won't fit beside it). */
const COMPACT_BELOW = 920;
/** Angle between adjacent date ranges on the wheel, and the wheel radius. */
const WHEEL_DEG = 55;
const WHEEL_R = 150;

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const toKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

interface Range {
  start: string;
  end: string;
}

/** Group the selected dates into consecutive runs: 3, 4, 5, 9 → [3–5], [9]. */
export function toRanges(keys: string[]): Range[] {
  const out: Range[] = [];
  for (const k of [...keys].sort()) {
    const last = out[out.length - 1];
    if (last) {
      const next = toDate(last.end);
      next.setDate(next.getDate() + 1);
      if (toKey(next) === k) {
        last.end = k;
        continue;
      }
    }
    out.push({ start: k, end: k });
  }
  return out;
}

const STYLE = /* css */ `
:host {
  --hp-pill-bg: #ebebeb;
  --hp-pill-open: #ffffff;
  --hp-fg: #222222;
  --hp-muted: #6a6a6a;
  --hp-panel-bg: #ffffff;
  --hp-ring: #222222;
  position: relative;
  display: inline-block;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: var(--hp-fg);
}
/* Dark theme: follows the system unless theme="light"; theme="dark" forces it */
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --hp-pill-bg: #2a2e35;
    --hp-pill-open: #353a42;
    --hp-fg: #eceef1;
    --hp-muted: #a3aab4;
    --hp-panel-bg: #202328;
    --hp-ring: #eceef1;
  }
}
:host([theme="dark"]) {
    --hp-pill-bg: #2a2e35;
    --hp-pill-open: #353a42;
    --hp-fg: #eceef1;
    --hp-muted: #a3aab4;
    --hp-panel-bg: #202328;
    --hp-ring: #eceef1;
  }
.pill {
  position: relative;
  transition: background 0.2s, box-shadow 0.2s, min-width 0.35s cubic-bezier(0.65, 0, 0.35, 1);
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  min-width: 17rem;
  box-sizing: border-box;
  padding: 12px 18px 12px 28px;
  border-radius: 999px;
  background: var(--hp-pill-bg);
  box-shadow: inset 0 0 0 2px transparent;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-y;
  outline: none;
}
.pill:hover { background: color-mix(in srgb, var(--hp-pill-bg) 85%, var(--hp-fg) 15%); }
.pill:focus-visible,
:host([open]) .pill { background: var(--hp-pill-open); box-shadow: inset 0 0 0 2px var(--hp-ring), 0 6px 20px rgba(0, 0, 0, 0.12); }
.label { font-size: 0.8rem; font-weight: 600; }
.value {
  position: relative;
  height: 1.5em;
  margin-top: 2px;
  font-size: 1.05rem;
  font-weight: 500;
  white-space: nowrap;
}
.single { position: absolute; inset: 0; }
:host([multi]) .pill { min-width: 21rem; }
.today { color: var(--hp-muted); }
/* Wheel for multiple date ranges: one range faces front, neighbouring ones turn to the sides and fade */
.wheel {
  position: absolute;
  inset: 0 -6px;
  perspective: 600px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent);
}
.wheel .item {
  position: absolute;
  white-space: nowrap;
  left: 50%;
  top: 0;
  transform-origin: 50% 50% ${-WHEEL_R}px;
  backface-visibility: hidden;
}
.side { display: flex; align-items: center; gap: 2px; }
.count {
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: var(--hp-muted);
  min-width: 2.2em;
  text-align: center;
}
.btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--hp-fg);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.btn:hover { background: color-mix(in srgb, var(--hp-fg) 10%, transparent); }
.btn[hidden], .count[hidden] { display: none; }
/* Buttons fade in when they appear rather than popping up */
.btn, .count { animation: hp-in 0.25s ease-out; }
@keyframes hp-in { from { opacity: 0; transform: scale(0.8); } }
/* Fixed to the screen (and moved along with the field as the page scrolls), so the book never widens the page: neither a
   book wider than a phone (the browser would zoom the whole page out) nor a page lifted to turn, which rises above
   everything round it. Put away, it stays laid out (hidden), ready to open */
.panel {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 50;
  box-sizing: border-box;
  padding: 8px 40px 0;
  border-radius: 32px;
  /* No card behind the calendar: the book floats over the page with only its own shadow. Nothing clips it either: a
     page lifted to turn rises above everything around it, the field it opened from included */
  background: transparent;
  visibility: hidden;
}
:host([open]) .panel { visibility: visible; }
/* On a small screen the calendar opens over the whole page, as large as fits: upright (pages turning up and down) on a
   tall screen, side by side on a wide one. A tap outside the book closes it */
.panel.compact {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  margin: 0;
  border: 0;
  overflow: visible;
  color: inherit;
  padding: 0;
  border-radius: 0;
  display: grid;
  place-items: center;
  background: var(--hp-scrim, rgba(24, 20, 14, 0.34));
  overscroll-behavior: contain;
  touch-action: none;
  z-index: 1000;
}
`;

const FORWARDED = ['threshold', 'week-start', 'locale', 'color', 'tool', 'brush-size', 'hold-delay', 'value', 'min', 'max', 'theme', 'finish'];

/**
 * <highlighter-picker>: a date field for booking sites.
 *
 * At rest it is a narrow field showing today's date; click it and it grows smoothly into the highlighter calendar
 * (first one month plus a stack of cards, which wiggles to hint that more months can be laid out); click outside or press Esc to collapse it.
 * Once dates are chosen the field shows the range, e.g. "Nov 14 – Dec 11"; with several ranges selected,
 * the field becomes a wheel you can turn left and right, listing every range.
 * Attributes and input / change events are the same as <highlighter-calendar>; it also has a label attribute and open() / close() methods.
 */
export class HighlighterPicker extends HTMLElement {
  static observedAttributes = ['label', ...FORWARDED];

  private $pill: HTMLElement;
  private $label: HTMLElement;
  private $single: HTMLElement;
  private $wheel: HTMLElement;
  private $count: HTMLElement;
  private $prev: HTMLButtonElement;
  private $next: HTMLButtonElement;
  private $clear: HTMLButtonElement;
  private $panel: HTMLElement;
  private deck: HighlighterBook;

  private locale: string | undefined;
  private customLabel: string | null = null;
  private ranges: Range[] = [];
  /** Where the wheel has turned to (range index, may be fractional). */
  private pos = 0;
  private wheelAnim = 0;
  private drag: { id: number; x: number; pos: number; moved: boolean; t: number; lastX: number; vx: number } | null = null;
  private wheelIdle = 0;
  private hinted = false;
  private anim: Animation[] = [];
  /** How far below the field the calendar hangs (px); less, even over the field, where the window is too short for it. */
  private drop = 12;
  /** The book's height laid out under the field (natural size), measured as it opens. */
  private dropH = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="pill" part="pill" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false">
        <div>
          <div class="label" part="label"></div>
          <div class="value" part="value">
            <span class="single"></span>
            <div class="wheel" hidden></div>
          </div>
        </div>
        <div class="side">
          <button class="btn prev" type="button" aria-label="Previous range" hidden>‹</button>
          <span class="count" hidden></span>
          <button class="btn next" type="button" aria-label="Next range" hidden>›</button>
          <button class="btn clear" type="button" aria-label="Clear" hidden>✕</button>
        </div>
      </div>
      <div class="panel" part="panel" role="dialog">
        <highlighter-book></highlighter-book>
      </div>`;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.$pill = q('.pill');
    this.$label = q('.label');
    this.$single = q('.single');
    this.$wheel = q('.wheel');
    this.$count = q('.count');
    this.$prev = q('.prev');
    this.$next = q('.next');
    this.$clear = q('.clear');
    this.$panel = q('.panel');
    this.deck = q('highlighter-book');

    this.deck.addEventListener('input', () => this.render());
    this.deck.addEventListener('change', () => this.render());
    this.$prev.addEventListener('click', (e) => {
      e.stopPropagation();
      this.rotateTo(Math.round(this.pos) - 1);
    });
    this.$next.addEventListener('click', (e) => {
      e.stopPropagation();
      this.rotateTo(Math.round(this.pos) + 1);
    });
    this.$clear.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deck.clear();
    });
    this.$pill.addEventListener('pointerdown', (e) => this.onDown(e));
    this.$pill.addEventListener('pointermove', (e) => this.onMove(e));
    this.$pill.addEventListener('pointerup', (e) => this.onUp(e));
    this.$pill.addEventListener('pointercancel', () => (this.drag = null));
    this.$pill.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Over the whole screen: a tap beside the book closes it
    this.$panel.addEventListener('pointerdown', (e) => {
      if (e.target === this.$panel && this.$panel.classList.contains('compact')) this.close();
    });
    this.$pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'ArrowLeft' && this.ranges.length > 1) {
        this.rotateTo(Math.round(this.pos) - 1);
      } else if (e.key === 'ArrowRight' && this.ranges.length > 1) {
        this.rotateTo(Math.round(this.pos) + 1);
      }
    });
  }

  connectedCallback(): void {
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onEsc);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.render();
  }

  disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onEsc);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    if (name === 'label') {
      this.customLabel = v;
    } else {
      if (name === 'locale') this.locale = v ?? undefined;
      if (v === null) this.deck.removeAttribute(name);
      else this.deck.setAttribute(name, v);
    }
    this.render();
  }

  // ---------- Public API ----------

  get value(): string[] {
    return this.deck.value;
  }

  set value(keys: string[]) {
    this.deck.value = keys;
    this.render();
  }

  get tool(): Tool {
    return this.deck.tool;
  }

  set tool(t: Tool) {
    this.deck.tool = t;
  }

  get color(): string {
    return this.deck.color;
  }

  set color(c: string) {
    this.deck.color = c;
  }

  get threshold(): number {
    return this.deck.threshold;
  }

  set threshold(n: number) {
    this.deck.threshold = n;
  }

  get isOpen(): boolean {
    return this.hasAttribute('open');
  }

  clear(): void {
    this.deck.clear();
  }

  /** Grow smoothly from the narrow field into the calendar. */
  open(): void {
    if (this.isOpen) return;
    // With dates selected, start at the month of the range the wheel is facing; otherwise start at this month
    const r = this.ranges[Math.round(this.pos)];
    const now = new Date();
    this.deck.show(r ? r.start.slice(0, 7) : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
    // Laid out for under the field first, to see whether the window has room for it there at all
    this.deck.setAttribute('layout', 'horizontal');
    this.deck.toggleAttribute('fit', false);
    this.deck.style.removeProperty('--hb-scale');
    this.deck.style.removeProperty('--hb-width');
    this.dropH = this.deck.naturalHeight;
    const compact = this.wantsCompact();
    this.$panel.classList.toggle('compact', compact);
    this.toggleAttribute('open', true);
    this.$pill.setAttribute('aria-expanded', 'true');
    this.stopAnim();
    if (compact) {
      // Over the whole screen: it fades in and the book rises into place
      this.$panel.style.width = '';
      this.$panel.style.left = '';
      this.$panel.style.top = '';
      // Above everything on the page, whatever it stacks itself in (a popover goes to the top layer)
      if (typeof this.$panel.showPopover === 'function') {
        this.$panel.popover = 'manual';
        this.$panel.showPopover();
      }
      this.fitScreen();
      this.anim = [
        this.$panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.6, easing: 'ease-out' }),
        this.deck.animate(
          [
            { opacity: 0, transform: 'translateY(28px) scale(0.97)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: OPEN_MS + 120, easing: EASE },
        ),
      ];
      this.anim[1].finished.then(() => this.isOpen && this.deck.hint()).catch(() => undefined);
      return;
    }
    this.drop = 12;
    this.positionPanel();
    this.makeRoom();

    const pill = this.$pill.getBoundingClientRect();
    const panel = this.$panel.getBoundingClientRect();
    const from = this.clipFrom(pill, panel);
    // The book comes out of the field: down into place below it, up into place above it
    const start = `translateY(${this.isAbove(pill, panel) ? 16 : -16}px) scale(0.98)`;
    this.anim = [
      this.$panel.animate(
        [
          { clipPath: from.clip, transform: from.move, opacity: 0.5 },
          { clipPath: 'inset(0px 0px 0px 0px round 32px)', transform: 'none', opacity: 1 },
        ],
        { duration: OPEN_MS, easing: EASE },
      ),
      this.deck.animate(
        [
          { opacity: 0, transform: start },
          { opacity: 0, transform: start, offset: 0.3 },
          { opacity: 1, transform: 'none' },
        ],
        { duration: OPEN_MS + 120, easing: EASE },
      ),
    ];
    // Once grown, wiggle the card stack to hint that more months can be laid out
    this.anim[1].finished.then(() => this.isOpen && this.deck.hint()).catch(() => undefined);
  }

  /** Play it in reverse, collapsing back into the narrow field. */
  close(): void {
    if (!this.isOpen) return;
    if (this.$panel.classList.contains('compact')) {
      this.stopAnim();
      const a = this.$panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OPEN_MS * 0.5, easing: 'ease-in', fill: 'forwards' });
      this.anim = [a];
      this.$pill.setAttribute('aria-expanded', 'false');
      a.finished
        .then(() => {
          this.toggleAttribute('open', false);
          this.putAway();
          a.cancel();
        })
        .catch(() => undefined);
      return;
    }
    const pill = this.$pill.getBoundingClientRect();
    const panel = this.$panel.getBoundingClientRect();
    const to = this.clipFrom(pill, panel);
    this.stopAnim();
    const a = this.$panel.animate(
      [
        { clipPath: 'inset(0px 0px 0px 0px round 32px)', transform: 'none', opacity: 1 },
        { clipPath: to.clip, transform: to.move, opacity: 0.4 },
      ],
      { duration: OPEN_MS * 0.8, easing: EASE, fill: 'forwards' },
    );
    this.anim = [a];
    this.$pill.setAttribute('aria-expanded', 'false');
    a.finished
      .then(() => {
        this.toggleAttribute('open', false);
        a.cancel();
      })
      .catch(() => undefined);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  // ---------- Internals ----------

  private stopAnim(): void {
    for (const a of this.anim) a.cancel();
    this.anim = [];
  }

  /** The panel sits below the narrow field, horizontally centred on it where possible but never outside the window. */
  private positionPanel(): void {
    const pill = this.$pill.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    // The book plus the panel's own side padding, so the book sits centred under the field
    const want = this.deck.naturalWidth + 80;
    const w = Math.min(want, vw - 16);
    this.$panel.style.width = `${w}px`;
    const center = pill.left + pill.width / 2;
    const left = Math.max(8, Math.min(vw - 8 - w, center - w / 2));
    this.$panel.style.left = `${left}px`;
    this.$panel.style.top = `${pill.bottom + this.drop}px`;
  }

  /**
   * A calendar hanging past the bottom of the window: the page scrolls up as it opens to show all of it (the calendar
   * rides along with the field). Where the page can't scroll that far, it opens upwards instead if there's room above the
   * field, or else rises as far as it must, over the field if need be.
   */
  private makeRoom(): void {
    const pill = this.$pill.getBoundingClientRect();
    const vh = document.documentElement.clientHeight;
    const h = this.$panel.offsetHeight;
    const over = pill.bottom + this.drop + h - (vh - 8);
    if (over <= 0) return;
    const page = document.scrollingElement ?? document.documentElement;
    const left = page.scrollHeight - vh - page.scrollTop;
    // (never scrolling so far that the field itself goes out of sight)
    const by = Math.max(0, Math.min(over, left, pill.top - 8));
    if (by < over && pill.top - 12 - h >= 8) this.drop = -(pill.height + 12 + h);
    else {
      if (by > 0) window.scrollBy({ top: by, behavior: 'smooth' });
      this.drop -= over - by;
    }
    this.positionPanel();
  }

  /** Too small a window for the book under the field: it opens over the whole screen instead, as large as fits. */
  private wantsCompact(): boolean {
    return window.innerWidth < COMPACT_BELOW || window.innerHeight < this.dropH + 32;
  }

  /**
   * Clip and offset for the panel collapsed to the narrow field's size: exactly covering the field. It folds into the
   * field from its near edge: the top of a calendar hanging below the field, the bottom of one opened above it.
   */
  private clipFrom(pill: DOMRect, panel: DOMRect): { clip: string; move: string } {
    const l = Math.max(0, pill.left - panel.left);
    const r = Math.max(0, panel.right - pill.right);
    const rest = Math.max(0, panel.height - pill.height);
    const round = `round ${pill.height / 2}px`;
    if (this.isAbove(pill, panel)) {
      return { clip: `inset(${rest}px ${r}px 0px ${l}px ${round})`, move: `translateY(${pill.bottom - panel.bottom}px)` };
    }
    return { clip: `inset(0px ${r}px ${rest}px ${l}px ${round})`, move: `translateY(${pill.top - panel.top}px)` };
  }

  /** Opened above the field (there was no room below it). */
  private isAbove(pill: DOMRect, panel: DOMRect): boolean {
    return panel.bottom <= pill.top + 1;
  }

  private onOutside = (e: PointerEvent): void => {
    if (this.isOpen && !e.composedPath().includes(this)) this.close();
  };

  /**
   * Size the book for the whole screen: upright on a tall screen, side by side on a wide one, as large as fits (never
   * larger than its natural size). The calendars are made as wide as the screen allows, then their print as large as
   * the height allows. The coil and margins round them don't scale, so the book's size is a straight line in each
   * scale, not proportional to it: measured at two values, it gives the one that fits.
   */
  private fitScreen(): void {
    const vertical = window.innerHeight > window.innerWidth;
    this.deck.setAttribute('layout', vertical ? 'vertical' : 'horizontal');
    this.deck.toggleAttribute('fit', true);
    const room = { w: window.innerWidth - 8, h: window.innerHeight - 8 };
    const set = (name: string, v: number) => this.deck.style.setProperty(name, v.toFixed(4));
    const size = () => ({ w: this.deck.naturalWidth, h: this.deck.naturalHeight });
    // The value (between 0.5 and 1 apart) at which a size measured at both ends is exactly what fits
    const solve = (at1: number, at05: number, want: number) => (at1 === at05 ? 1 : 0.5 + ((want - at05) * 0.5) / (at1 - at05));
    set('--hb-scale', 1);
    set('--hb-width', 1);
    const full = size();
    if (!full.w || (full.w <= room.w && full.h <= room.h)) return;
    set('--hb-width', 0.5);
    const narrow = size();
    set('--hb-width', Math.max(0.4, Math.min(1, solve(full.w, narrow.w, room.w))));
    const wide = size();
    if (wide.h <= room.h) return;
    set('--hb-scale', 0.5);
    const small = size();
    set('--hb-scale', Math.max(0.4, Math.min(1, solve(wide.h, small.h, room.h))));
  }

  /** Out of the top layer again, laid out (hidden) where it can't widen the page, ready for next time. */
  private putAway(): void {
    if (this.$panel.popover) {
      if (this.$panel.matches(':popover-open')) this.$panel.hidePopover();
      this.$panel.removeAttribute('popover');
    }
  }

  /** Under the field, the calendar moves with it as the page scrolls. */
  private onScroll = (): void => {
    if (this.isOpen && !this.$panel.classList.contains('compact')) this.positionPanel();
  };

  /** The screen turned or changed size while open: lay the calendar out again for it. */
  private onResize = (): void => {
    if (!this.isOpen) return;
    const compact = this.wantsCompact();
    if (compact !== this.$panel.classList.contains('compact')) {
      // From one way of opening to the other: just put it away (it opens the right way next time)
      this.stopAnim();
      this.toggleAttribute('open', false);
      this.putAway();
      this.$pill.setAttribute('aria-expanded', 'false');
      return;
    }
    if (compact) this.fitScreen();
    else this.positionPanel();
  };

  private onEsc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) this.close();
  };

  private labelText(): string {
    if (this.customLabel !== null) return this.customLabel;
    const lang = (this.locale ?? navigator.language ?? 'en').toLowerCase();
    return lang.startsWith('zh') ? '日期' : lang.startsWith('ja') ? '日付' : 'When';
  }

  private formatRange(r: Range): string {
    const a = toDate(r.start);
    const b = toDate(r.end);
    const year = new Date().getFullYear();
    // CJK locales use the long month form (native month/day characters); other languages use a short form like "Nov 14"
    const lang = (this.locale ?? navigator.language ?? 'en').toLowerCase();
    const month = /^(zh|ja|ko)/.test(lang) ? 'long' : 'short';
    const opts: Intl.DateTimeFormatOptions =
      a.getFullYear() === year && b.getFullYear() === year
        ? { month, day: 'numeric' }
        : { year: 'numeric', month, day: 'numeric' };
    const fmt = new Intl.DateTimeFormat(this.locale ?? navigator.language, opts);
    if (r.start === r.end) return fmt.format(a);
    if (month === 'short') return fmt.formatRange(a, b);
    // ICU formats Chinese ranges as "11/14 – 12/11", so build the range by hand from the long-form dates instead
    const sameMonth = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    const tail = sameMonth ? new Intl.DateTimeFormat(this.locale ?? navigator.language, { day: 'numeric' }).format(b) : fmt.format(b);
    return `${fmt.format(a)} – ${tail}`;
  }

  /** Refresh the narrow field for the current selection: today when nothing is selected, the range when there is one, a wheel when there are several. */
  private render(): void {
    this.$label.textContent = this.labelText();
    const ranges = toRanges(this.deck.value ?? []);
    const changed = ranges.map((r) => r.start + r.end).join() !== this.ranges.map((r) => r.start + r.end).join();
    this.ranges = ranges;
    const n = ranges.length;
    this.$clear.hidden = n === 0;
    this.$prev.hidden = this.$next.hidden = this.$count.hidden = n < 2;
    this.$wheel.hidden = n < 2;
    this.$single.hidden = n >= 2;
    this.toggleAttribute('multi', n >= 2);

    const before = this.$single.hidden ? this.$wheel.textContent : this.$single.textContent;
    if (n === 0) {
      this.$single.textContent = this.formatRange({ start: toKey(new Date()), end: toKey(new Date()) });
      this.$single.classList.add('today');
      this.hinted = false;
    } else if (n === 1) {
      this.$single.textContent = this.formatRange(ranges[0]);
      this.$single.classList.remove('today');
      this.hinted = false;
    }
    // The text changed: the old one fades out and the new one fades in from below, instead of swapping abruptly
    const shown = n >= 2 ? this.$wheel : this.$single;
    if (before !== null && before !== shown.textContent && this.isConnected) {
      shown.animate(
        [
          { opacity: 0, transform: 'translateY(5px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' },
      );
    } else if (changed) {
      this.$wheel.innerHTML = '';
      for (const r of ranges) {
        const s = document.createElement('span');
        s.className = 'item';
        s.textContent = this.formatRange(r);
        this.$wheel.append(s);
      }
      this.pos = Math.min(Math.max(0, Math.round(this.pos)), n - 1);
      this.layoutWheel();
      // The first time it becomes several ranges, the wheel wobbles by itself to show it can be turned
      if (!this.hinted) {
        this.hinted = true;
        this.wiggleWheel();
      }
    }
  }

  private layoutWheel(): void {
    const items = this.$wheel.children;
    for (let i = 0; i < items.length; i++) {
      const el = items[i] as HTMLElement;
      const deg = (i - this.pos) * WHEEL_DEG;
      const vis = Math.abs(deg) < 90;
      el.style.visibility = vis ? '' : 'hidden';
      el.style.transform = `translateX(-50%) rotateY(${deg}deg)`;
      el.style.opacity = String(Math.max(0, Math.cos((deg * Math.PI) / 180)) ** 3);
    }
    const n = this.ranges.length;
    this.$count.textContent = `${Math.round(this.pos) + 1}/${n}`;
  }

  /** Turn smoothly to range i (bouncing back gently at either end). */
  private rotateTo(i: number, ms = 420): void {
    const n = this.ranges.length;
    if (n < 2) return;
    const target = Math.max(0, Math.min(n - 1, i));
    cancelAnimationFrame(this.wheelAnim);
    const from = this.pos;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
      this.pos = from + (target - from) * e;
      this.layoutWheel();
      if (p < 1) this.wheelAnim = requestAnimationFrame(tick);
    };
    this.wheelAnim = requestAnimationFrame(tick);
  }

  private wiggleWheel(): void {
    cancelAnimationFrame(this.wheelAnim);
    const base = Math.round(this.pos);
    const dir = base < this.ranges.length - 1 ? 1 : -1;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (t > 1.2) {
        this.pos = base;
        this.layoutWheel();
        return;
      }
      this.pos = base + dir * 0.28 * Math.abs(Math.sin((t * Math.PI) / 0.4)) * Math.exp(-t * 2.2);
      this.layoutWheel();
      this.wheelAnim = requestAnimationFrame(tick);
    };
    this.wheelAnim = requestAnimationFrame(tick);
  }

  // ---------- Gestures on the narrow field: click to open, drag sideways to turn the wheel ----------

  private onDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.drag = { id: e.pointerId, x: e.clientX, pos: this.pos, moved: false, t: e.timeStamp, lastX: e.clientX, vx: 0 };
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId || this.ranges.length < 2) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) {
      d.moved = true;
      cancelAnimationFrame(this.wheelAnim);
      try {
        this.$pill.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events have no real pointer
      }
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.vx = d.vx * 0.5 + ((e.clientX - d.lastX) / dt) * 0.5;
    d.lastX = e.clientX;
    d.t = e.timeStamp;
    // Dragging left turns the wheel forward (revealing later ranges)
    this.pos = d.pos - dx / 70;
    this.layoutWheel();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      this.toggle();
      return;
    }
    // On release: carry on a little in the direction of the flick and settle on the nearest range
    this.rotateTo(Math.round(this.pos - d.vx * 1.5));
  }

  private onWheel(e: WheelEvent): void {
    if (this.ranges.length < 2) return;
    e.preventDefault();
    cancelAnimationFrame(this.wheelAnim);
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.pos = Math.max(-0.4, Math.min(this.ranges.length - 0.6, this.pos + delta / 120));
    this.layoutWheel();
    clearTimeout(this.wheelIdle);
    this.wheelIdle = window.setTimeout(() => this.rotateTo(Math.round(this.pos), 260), 120);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'highlighter-picker': HighlighterPicker;
  }
}

export type { CalendarChangeDetail };
