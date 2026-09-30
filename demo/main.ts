import '../src/index';
import type { CalendarChangeDetail } from '../src/index';

const $ = (id: string) => document.getElementById(id)!;
const cal = document.querySelector('highlighter-picker')!;

function pick(groupId: string, attr: string, apply: (v: string) => void) {
  const group = $(groupId);
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    apply(btn.dataset[attr]!);
  });
}

pick('tool', 'tool', (v) => (cal.tool = v as 'highlight' | 'erase'));
pick('colors', 'color', (v) => (cal.color = v));
pick('week', 'ws', (v) => cal.setAttribute('week-start', v));

const slider = $('threshold') as HTMLInputElement;
slider.addEventListener('input', () => {
  cal.threshold = Number(slider.value);
  $('th-out').textContent = slider.value;
  $('th-inline').textContent = slider.value;
});

$('clear').addEventListener('click', () => cal.clear());

const dayFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

/** Merge a list of dates into ranges for display: Sep 3 – Sep 6, Sep 10 */
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
cal.addEventListener('change', (e) => {
  const { value, added, removed } = (e as CustomEvent<CalendarChangeDetail>).detail;
  show(value);
  const li = document.createElement('li');
  li.textContent = [added.length ? `+ ${added.join(', ')}` : '', removed.length ? `− ${removed.join(', ')}` : '']
    .filter(Boolean)
    .join('   ');
  $('log').prepend(li);
});
