import { HighlighterCalendar } from './calendar';
import { HighlighterBook } from './book';
import { HighlighterDeck } from './deck';
import { HighlighterPicker } from './picker';
import { RetroCalendar } from './retro';
import { RetroPicker } from './retro-picker';

export { HighlighterCalendar, dateKey, type CalendarChangeDetail } from './calendar';
export { HighlighterBook } from './book';
export { HighlighterDeck } from './deck';
export { HighlighterPicker, toRanges } from './picker';
export { RetroCalendar } from './retro';
export { RetroPicker } from './retro-picker';
export { HighlighterEngine, GRID, CELLS, DEFAULT_THRESHOLD, type Tool, type RowLayout, type DayRect } from './engine';

let baseDefined = false;

/** Register the custom element (default name highlighter-calendar); safe to call more than once. */
export function defineHighlighterCalendar(tag = 'highlighter-calendar'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    // A class can only be registered once, so registering under another name uses a subclass
    customElements.define(tag, baseDefined ? class extends HighlighterCalendar {} : HighlighterCalendar);
    baseDefined = true;
  }
}

defineHighlighterCalendar();

if (typeof customElements !== 'undefined' && !customElements.get('highlighter-deck')) {
  customElements.define('highlighter-deck', HighlighterDeck);
}

// The date picker uses the book, so register the book first
if (typeof customElements !== 'undefined' && !customElements.get('highlighter-book')) {
  customElements.define('highlighter-book', HighlighterBook);
}

if (typeof customElements !== 'undefined' && !customElements.get('highlighter-picker')) {
  customElements.define('highlighter-picker', HighlighterPicker);
}

if (typeof customElements !== 'undefined' && !customElements.get('retro-calendar')) {
  customElements.define('retro-calendar', RetroCalendar);
}

// The date field holds the calculator, so it comes after it
if (typeof customElements !== 'undefined' && !customElements.get('retro-picker')) {
  customElements.define('retro-picker', RetroPicker);
}
