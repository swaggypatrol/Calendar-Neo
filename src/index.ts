import { HighlighterCalendar } from './calendar';
import { HighlighterBook } from './book';
import { HighlighterDeck } from './deck';
import { HighlighterPicker } from './picker';

export { HighlighterCalendar, dateKey, type CalendarChangeDetail } from './calendar';
export { HighlighterBook } from './book';
export { HighlighterDeck } from './deck';
export { HighlighterPicker, toRanges } from './picker';
export { HighlighterEngine, GRID, CELLS, DEFAULT_THRESHOLD, type Tool, type RowLayout, type DayRect } from './engine';

let baseDefined = false;

/** 注册自定义元素（默认名 highlighter-calendar），重复调用是安全的。 */
export function defineHighlighterCalendar(tag = 'highlighter-calendar'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    // 同一个类只能注册一次，换名字注册时用子类
    customElements.define(tag, baseDefined ? class extends HighlighterCalendar {} : HighlighterCalendar);
    baseDefined = true;
  }
}

defineHighlighterCalendar();

if (typeof customElements !== 'undefined' && !customElements.get('highlighter-deck')) {
  customElements.define('highlighter-deck', HighlighterDeck);
}

// 日期框里用到书，要先注册书
if (typeof customElements !== 'undefined' && !customElements.get('highlighter-book')) {
  customElements.define('highlighter-book', HighlighterBook);
}

if (typeof customElements !== 'undefined' && !customElements.get('highlighter-picker')) {
  customElements.define('highlighter-picker', HighlighterPicker);
}
