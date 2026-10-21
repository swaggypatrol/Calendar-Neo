/**
 * Single date: the calculator. <retro-calendar> (one month or two), <retro-frame> (its body and top row around a
 * page's own content) and <retro-picker> (the date field it slides out of). Importing this entry registers all three
 * and needs nothing from the multi-date half.
 */
import { RetroCalendar } from './retro';
import { RetroFrame } from './retro-frame';
import { RetroPicker } from './retro-picker';

export { RetroCalendar } from './retro';
export { RetroFrame } from './retro-frame';
export { RetroShell, type MonthChangeReason } from './retro-shell';
export { RetroPicker } from './retro-picker';

if (typeof customElements !== 'undefined' && !customElements.get('retro-calendar')) {
  customElements.define('retro-calendar', RetroCalendar);
}

if (typeof customElements !== 'undefined' && !customElements.get('retro-frame')) {
  customElements.define('retro-frame', RetroFrame);
}

// The date field holds the calculator, so it comes after it
if (typeof customElements !== 'undefined' && !customElements.get('retro-picker')) {
  customElements.define('retro-picker', RetroPicker);
}
