import '../src/index';
import type { CalendarChangeDetail } from '../src/index';

const $ = (id: string) => document.getElementById(id)!;
const cal = document.querySelector('highlighter-deck')!;

function pick(groupId: string, attr: string, apply: (v: string) => void) {
  const group = $(groupId);
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    apply(btn.dataset[attr]!);
  });
}

pick('min', 'min', (v) => cal.setAttribute('min', v));
pick('max', 'max', (v) => (v ? cal.setAttribute('max', v) : cal.removeAttribute('max')));
pick('tool', 'tool', (v) => (cal.tool = v as 'highlight' | 'erase'));
pick('colors', 'color', (v) => (cal.color = v));
$('clear').addEventListener('click', () => cal.clear());

const dayFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

/** Merge a list of dates into ranges for display: Oct 3 – Oct 6, Oct 10 */
function ranges(keys: string[]): string {
  if (!keys.length) return 'No dates selected yet';
  const days = keys.map((k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  });
  const fmt = (d: Date) => dayFmt.format(d);
  const out: string[] = [];
  let start = days[0];
  let prev = days[0];
  for (const d of [...days.slice(1), null]) {
    if (d && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1) {
      prev = d;
      continue;
    }
    out.push(start === prev ? fmt(start) : `${fmt(start)} – ${fmt(prev)}`);
    if (d) start = prev = d;
  }
  return out.join(', ');
}

function show(value: string[]) {
  $('count').textContent = String(value.length);
  $('ranges').textContent = ranges(value);
  $('json').textContent = JSON.stringify(value);
}

cal.addEventListener('input', (e) => show((e as unknown as CustomEvent<CalendarChangeDetail>).detail.value));
cal.addEventListener('change', (e) => show((e as CustomEvent<CalendarChangeDetail>).detail.value));
