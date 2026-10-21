import { RetroShell } from './retro-shell';

const FRAME_STYLE = /* css */ `
/* The frame fills the width it is given; its keys and print stay the size of a calculator --rc-width wide */
:host {
  display: block;
  width: auto;
}
.shell {
  --u: min(1cqi, calc(var(--rc-width) / 100));
}
.fn {
  grid-template-columns: var(--slot-w) 1fr var(--slot-w) var(--slot-w);
}
.title { grid-column: auto; }
/* The page's content, which gives way to the twelve month keys while they are up */
.content {
  margin-top: calc(var(--g) * 1.618);
  transition: opacity 0.3s ease var(--plate, 0s);
}
.content.away { opacity: 0; }
/* The month keys at their calculator size, at the top of the content's place */
.months {
  inset: calc(var(--g) * 1.618) auto auto 50%;
  width: calc(100 * var(--u) - 2 * var(--pad));
  height: calc(var(--g) * 4.854 + 6 * (var(--kh) + 2 * var(--lip) + var(--t)) + 5 * var(--g));
  transform: translateX(-50%);
}
.months-up .board {
  min-height: calc(var(--g) * 6.472 + 6 * (var(--kh) + 2 * var(--lip) + var(--t)) + 5 * var(--g));
}
`;

/**
 * <retro-frame>: the calculator's body, top row and month pad around content the page provides. The arrows turn the
 * month, Today brings back this month, and the month at the top opens the twelve month keys (the arrows then turn the
 * year; a month key brings the content back for that month). What the content shows for the month, how it looks and
 * what pressing it does is the page's: the frame only tells it which month to show.
 *
 * Attributes: month="2026-10"  min="today"  max="+90"  locale="ja-JP"  theme="light|dark"
 * Events: monthchange (detail: { month, reason: 'prev' | 'next' | 'today' | 'pick' | 'swipe' | 'range' | 'api' })
 */
export class RetroFrame extends RetroShell {
  static observedAttributes = ['month', 'min', 'max', 'locale', 'theme'];

  private $content: HTMLElement;

  constructor() {
    super(FRAME_STYLE, `<div class="content" part="content"><slot></slot></div>`);
    this.$content = this.shadowRoot!.querySelector('.content') as HTMLElement;
  }

  protected bodyView(): HTMLElement {
    return this.$content;
  }

  protected render(dir: number): void {
    this.range.refresh();
    if (this._view === 'days') this.roll(this.$roll, this.titleText(), dir);
    else this.renderMonths(0);
    this.updateFn();
    this.$readout.textContent = this.titleText();
    this.rendered = true;
    this.syncFocus();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'retro-frame': RetroFrame;
  }
}
