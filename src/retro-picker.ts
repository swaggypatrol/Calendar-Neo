import type { RetroCalendar } from './retro';
import { fieldDate, keyOf } from './keypad';

/** How long the calculator takes to run out of the field, and to go back in. */
const OPEN_MS = 620;
const CLOSE_MS = 440;
/** Out like a drawer on good runners: it moves off gently from rest, then slows all the way into place. */
const EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** And back in: gathering speed, then easing into the field, so it never vanishes at full tilt. */
const EASE_IN = 'cubic-bezier(0.65, 0, 0.35, 1)';
/** Room between the field and the calculator. */
const GAP = 10;
/** How far beyond the calculator's edge the opening reaches at the end, so none of its shadow is cut off. */
const BLEED = 72;

const WORD: Record<string, string> = { en: 'Date', ja: '日付', zh: '日期' };

const ICON = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;

const STYLE = /* css */ `
:host {
  /* A plain booking-site field: white, a hairline border, the site's yellow for the icon and the ring */
  --rp-bg: #ffffff;
  --rp-border: #e5e7eb;
  --rp-fg: #111827;
  --rp-muted: #6b7280;
  --rp-icon: #eab308;
  --rp-ring: #facc15;
  --rp-radius: 12px;
  --rp-height: 52px;
  /* The calculator that comes out of it (everything in it scales with this) */
  --rc-width: 24rem;
  display: inline-block;
  position: relative;
  min-width: 12rem;
  vertical-align: middle;
  font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--rp-fg);
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --rp-bg: #1d2026;
    --rp-border: rgba(255, 255, 255, 0.12);
    --rp-fg: #f3f4f6;
    --rp-muted: #9ca3af;
  }
}
:host([theme="dark"]) {
  --rp-bg: #1d2026;
  --rp-border: rgba(255, 255, 255, 0.12);
  --rp-fg: #f3f4f6;
  --rp-muted: #9ca3af;
}
.field {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  height: var(--rp-height);
  margin: 0;
  padding: 0 16px;
  border: 1px solid var(--rp-border);
  border-radius: var(--rp-radius);
  background: var(--rp-bg);
  color: inherit;
  font: inherit;
  font-size: 1rem;
  text-align: left;
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.2s ease, box-shadow 0.3s ease, transform 0.2s ease;
}
@media (hover: hover) {
  .field:hover { border-color: color-mix(in srgb, var(--rp-border), var(--rp-fg) 22%); }
}
.field:active { transform: scale(0.985); }
.field:focus-visible, .field[aria-expanded="true"] {
  border-color: var(--rp-ring);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rp-ring) 35%, transparent);
}
.icon { flex: none; width: 22px; height: 22px; color: var(--rp-icon); }
/* The date, which rolls over when it changes rather than swapping at once */
.value { position: relative; flex: 1; min-width: 0; height: 1.5em; overflow: hidden; }
.value > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  white-space: nowrap;
}
.value > .placeholder { color: var(--rp-muted); }
@supports (corner-shape: squircle) {
  .field { corner-shape: squircle; border-radius: calc(var(--rp-radius) * 1.3); }
}
/* Fixed to the screen and moved along with the field as the page scrolls, so it never widens the page. Put away, it is
   still laid out (hidden), its glass already cut, ready to come out */
.panel {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 50;
  visibility: hidden;
}
:host([open]) .panel { visibility: visible; }
retro-calendar { --rc-width: inherit; }
`;

const FORWARDED = ['value', 'month', 'min', 'max', 'week-start', 'locale', 'theme'];

/**
 * <retro-picker>: a booking site's date field with the calculator (<retro-calendar>) inside it.
 *
 * At rest it is a plain field showing today's date, greyed. Press it and the calculator slides out of it, a slab of
 * frosted glass that runs out from under the field and grows into the whole calculator while its keys rise row by row;
 * press it again, click outside or press Esc, and it all goes back in. The moment a key latches the field shows the date.
 * Attributes and events are the calendar's (change with detail: { value }, monthchange); also placeholder, and the
 * methods open() / close() / toggle() / clear().
 */
export class RetroPicker extends HTMLElement {
  static observedAttributes = ['placeholder', ...FORWARDED];

  private $field: HTMLButtonElement;
  private $value: HTMLElement;
  private $panel: HTMLElement;
  private cal: RetroCalendar;
  private locale: string | undefined;
  private placeholder: string | null = null;
  private anim: Animation | null = null;
  private closing = false;
  /** Which side of the field the calculator came out on. */
  private side: 'below' | 'above' = 'below';
  /** How far below the field it hangs (less than GAP where the window is too short for it, over the field if it must). */
  private drop = GAP;
  /** What the field says now. */
  private shown = '';

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <button class="field" part="field" type="button" aria-haspopup="dialog" aria-expanded="false">
        ${ICON}
        <span class="value" part="value"></span>
      </button>
      <div class="panel" part="panel" role="dialog">
        <retro-calendar></retro-calendar>
      </div>`;
    this.$field = root.querySelector('.field')!;
    this.$value = root.querySelector('.value')!;
    this.$panel = root.querySelector('.panel')!;
    this.cal = root.querySelector('retro-calendar') as RetroCalendar;
    customElements.upgrade(this.cal);

    this.cal.addEventListener('change', () => this.paint(true));
    // A click from the keyboard (Enter / Space) has no detail: then the keys take the focus as it opens
    this.$field.addEventListener('click', (e) => this.toggle(e.detail === 0));
    this.$field.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !this.isOpen) {
        e.preventDefault();
        this.open(true);
      }
    });
  }

  connectedCallback(): void {
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onEsc);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.paint(false);
  }

  disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onEsc);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
  }

  attributeChangedCallback(name: string, _old: string | null, v: string | null): void {
    if (name === 'placeholder') {
      this.placeholder = v;
    } else {
      if (name === 'locale') this.locale = v ?? undefined;
      if (v === null) this.cal.removeAttribute(name);
      else this.cal.setAttribute(name, v);
    }
    this.paint(false);
  }

  // ---------- Public API ----------

  /** The chosen date (YYYY-MM-DD), or null. */
  get value(): string | null {
    return this.cal.value;
  }

  set value(v: string | null) {
    this.cal.value = v;
    this.paint(true);
  }

  /** The calculator it holds, for anything not repeated here. */
  get calendar(): RetroCalendar {
    return this.cal;
  }

  get isOpen(): boolean {
    return this.hasAttribute('open') && !this.closing;
  }

  clear(): void {
    this.cal.clear();
  }

  /** Slide the calculator out of the field. With focus, the keyboard goes to its keys. */
  open(focus = false): void {
    if (this.isOpen) return;
    this.$field.setAttribute('aria-expanded', 'true');
    let frames: Keyframe[];
    if (this.closing && this.anim) {
      // Caught on its way back in: it turns round from wherever it is
      const sliding = this.sliding();
      frames = sliding
        ? [{ ...this.current(), offset: 0, easing: EASE_OUT }, { ...this.out(), offset: 0.8, easing: 'ease-out' }, { ...this.free(), offset: 1 }]
        : [{ ...this.current(), offset: 0, easing: 'ease-out' }, { ...this.free(), offset: 1 }];
      this.closing = false;
      this.cal.unfold(0);
    } else {
      // Laid out at the month of the chosen date (or this month), on the days, every key down in the body
      const v = this.cal.value;
      const now = new Date();
      this.cal.setView('days', false);
      this.cal.fold(false);
      this.cal.show(v ?? keyOf(now.getFullYear(), now.getMonth(), 1), false);
      this.toggleAttribute('open', true);
      this.size();
      this.makeRoom();
      this.position();
      // Out from under the field, cut off along the field's edge all the way, as wide as the field at first and opening
      // out to its own width; once it is out, the cut moves off so its shadow can fall back over the field too
      frames = [
        { ...this.inside(), offset: 0, easing: EASE_OUT },
        { ...this.out(), offset: 0.82, easing: 'ease-out' },
        { ...this.free(), offset: 1 },
      ];
      // The keys rise once most of it is out, row after row as it slows down
      this.cal.unfold(OPEN_MS * 0.36);
    }
    const a = this.run(frames, OPEN_MS);
    a.finished
      .then(() => {
        if (this.anim !== a) return;
        a.cancel();
        this.anim = null;
      })
      .catch(() => undefined);
    if (focus) this.cal.focus({ preventScroll: true });
  }

  /** Send it back into the field: the keys sink, and it slides back in under the field after them. */
  close(refocus = false): void {
    if (!this.isOpen) return;
    // (caught on its way out, it turns round from wherever it is)
    const turning = !!this.anim;
    const frames: Keyframe[] =
      turning && this.sliding()
        ? [{ ...this.current(), offset: 0, easing: EASE_IN }, { ...this.inside(), offset: 1 }]
        : [
            { ...(turning ? this.current() : this.free()), offset: 0, easing: 'ease-in' },
            { ...this.out(), offset: 0.14, easing: EASE_IN },
            { ...this.inside(), offset: 1 },
          ];
    this.closing = true;
    this.$field.setAttribute('aria-expanded', 'false');
    this.cal.fold(true);
    const a = this.run(frames, CLOSE_MS, turning ? 0 : 110);
    a.finished
      .then(() => {
        if (this.anim !== a) return;
        this.closing = false;
        this.toggleAttribute('open', false);
        a.cancel();
        this.anim = null;
      })
      .catch(() => undefined);
    if (refocus) this.$field.focus({ preventScroll: true });
  }

  toggle(focus = false): void {
    if (this.isOpen) this.close();
    else this.open(focus);
  }

  // ---------- Internals ----------

  private run(frames: Keyframe[], ms: number, delay = 0): Animation {
    this.anim?.cancel();
    const a = this.$panel.animate(frames, { duration: ms, delay, easing: 'linear', fill: 'both' });
    this.anim = a;
    return a;
  }

  /** Where it is now, part way out or in. */
  private current(): Keyframe {
    const cs = getComputedStyle(this.$panel);
    return { clipPath: cs.clipPath, transform: cs.transform };
  }

  /** Still moving in or out (rather than only uncovering its shadow). */
  private sliding(): boolean {
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(this.$panel).transform);
    return !!m && Math.abs(Number(m[1].split(',')[5])) > 0.5;
  }

  /** The field and the calculator's box as they lie now (the box without any of the motion). */
  private boxes() {
    const f = this.$field.getBoundingClientRect();
    const left = parseFloat(this.$panel.style.left) || 0;
    const top = parseFloat(this.$panel.style.top) || 0;
    const w = this.$panel.offsetWidth;
    const h = this.$panel.offsetHeight;
    const r = parseFloat(getComputedStyle(this.$field).borderBottomLeftRadius) || 0;
    return { f, left, top, w, h, r };
  }

  /**
   * All the way in: slid up under the field until its far edge meets the field's near edge, and cut off along that
   * edge, as wide as the field, so none of it shows. (Above the field, the same the other way up.)
   */
  private inside(): Keyframe {
    const { f, left, top, w, h, r } = this.boxes();
    const l = f.left - left;
    const rr = left + w - f.right;
    if (this.side === 'below') {
      return { transform: `translateY(${f.bottom - (top + h)}px)`, clipPath: `inset(${h}px ${rr}px 0px ${l}px round ${r}px)` };
    }
    return { transform: `translateY(${f.top - top}px)`, clipPath: `inset(0px ${rr}px ${h}px ${l}px round ${r}px)` };
  }

  /** All the way out, still cut off along the field's edge (which it now stands clear of), and at its full width. */
  private out(): Keyframe {
    const { f, top, h } = this.boxes();
    const edge = this.side === 'below' ? `${f.bottom - top}px ${-BLEED}px ${-BLEED}px` : `${-BLEED}px ${-BLEED}px ${top + h - f.top}px`;
    return { transform: 'translateY(0px)', clipPath: `inset(${edge} ${-BLEED}px round ${BLEED}px)` };
  }

  /** Out and nothing cut off, its shadow included. */
  private free(): Keyframe {
    return { transform: 'translateY(0px)', clipPath: `inset(${-BLEED}px ${-BLEED}px ${-BLEED}px ${-BLEED}px round ${BLEED}px)` };
  }

  /**
   * A calculator that would hang past the bottom of the window: the page scrolls up to make room for it, and it rides
   * along with the field all the way, so it keeps coming out of the field's edge as the page moves. Where the page can't
   * scroll that far, it comes out above the field if there is room there, or else rises as far as it must.
   */
  private makeRoom(): void {
    const f = this.$field.getBoundingClientRect();
    const vh = document.documentElement.clientHeight;
    const h = this.$panel.offsetHeight;
    this.side = 'below';
    this.drop = GAP;
    const over = f.bottom + GAP + h - (vh - 8);
    if (over <= 0) return;
    const page = document.scrollingElement ?? document.documentElement;
    const room = page.scrollHeight - vh - page.scrollTop;
    // (never scrolling so far that the field itself goes out of sight)
    const by = Math.max(0, Math.min(over, room, f.top - 8));
    if (by < over && f.top - GAP - h >= 8) {
      this.side = 'above';
      return;
    }
    if (by > 0) window.scrollBy({ top: by, behavior: 'smooth' });
    this.drop -= over - by;
  }

  /** As wide as it likes, but never wider than the window or taller than it (everything in it shrinks to match). */
  private size(): void {
    const p = this.$panel;
    p.style.width = '';
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const k = Math.min(1, (document.documentElement.clientWidth - 16) / w, (document.documentElement.clientHeight - 16) / h);
    if (k < 1) p.style.width = `${Math.floor(w * k)}px`;
  }

  /** Under (or over) the field and moving with it, centred on it where the window allows. */
  private position(): void {
    const p = this.$panel;
    const f = this.$field.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = p.offsetWidth;
    const left = Math.max(8, Math.min(vw - 8 - w, f.left + f.width / 2 - w / 2));
    const top = this.side === 'below' ? f.bottom + this.drop : f.top - GAP - p.offsetHeight;
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  }

  private word(): string {
    const lang = (this.locale ?? navigator.language ?? 'en').toLowerCase();
    return WORD[lang.slice(0, 2)] ?? WORD.en;
  }

  /** The field: the chosen date, or (greyed) today's date or the placeholder; a new date rolls in from below. */
  private paint(animate: boolean): void {
    const v = this.cal.value;
    const now = new Date();
    const text = v ? fieldDate(v, this.locale) : (this.placeholder ?? fieldDate(keyOf(now.getFullYear(), now.getMonth(), now.getDate()), this.locale));
    this.$field.setAttribute('aria-label', v ? `${this.word()}: ${text}` : this.word());
    const sig = `${v ? '1' : '0'}${text}`;
    if (sig === this.shown) return;
    this.shown = sig;
    const next = document.createElement('span');
    next.textContent = text;
    next.classList.toggle('placeholder', !v);
    const old = [...this.$value.children] as HTMLElement[];
    if (!animate || !old.length || !this.isConnected) {
      this.$value.replaceChildren(next);
      return;
    }
    this.$value.append(next);
    const ease = 'cubic-bezier(0.25, 0.8, 0.3, 1)';
    for (const o of old) {
      o.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-70%)' }], {
        duration: 240,
        easing: ease,
        fill: 'forwards',
      }).onfinish = () => o.remove();
    }
    next.animate([{ opacity: 0, transform: 'translateY(70%)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: ease });
  }

  private onOutside = (e: PointerEvent): void => {
    if (this.isOpen && !e.composedPath().includes(this)) this.close();
  };

  private onEsc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) this.close(e.composedPath().includes(this));
  };

  private onScroll = (): void => {
    if (this.hasAttribute('open')) this.position();
  };

  /** The window changed size while it is out: sized for it again, and under the field still if it fits there. */
  private onResize = (): void => {
    if (!this.hasAttribute('open')) return;
    this.size();
    if (this.side === 'below') {
      const room = document.documentElement.clientHeight - 8 - this.$field.getBoundingClientRect().bottom;
      this.drop = Math.min(GAP, room - this.$panel.offsetHeight);
    }
    this.position();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'retro-picker': RetroPicker;
  }
}
