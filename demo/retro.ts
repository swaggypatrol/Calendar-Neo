import '../src/index';
import type { RetroCalendar, RetroFrame, RetroPicker } from '../src/index';

const $ = (id: string) => document.getElementById(id)!;
const cal = $('cal') as RetroPicker;
const duo = $('duo') as RetroCalendar;
const frame = $('frm') as RetroFrame;

function pick(groupId: string, attr: string, apply: (v: string) => void) {
  const group = $(groupId);
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    apply(btn.dataset[attr]!);
  });
}

const calendars = [cal, duo];
pick('min', 'min', (v) => calendars.forEach((c) => (v ? c.setAttribute('min', v) : c.removeAttribute('min'))));
pick('lang', 'lang', (v) => [...calendars, frame].forEach((c) => c.setAttribute('locale', v)));
pick('week', 'ws', (v) => calendars.forEach((c) => c.setAttribute('week-start', v)));
pick('months', 'n', (v) => cal.setAttribute('months', v));

const log = $('log');
cal.addEventListener('change', (e) => {
  const { value } = (e as CustomEvent<{ value: string | null }>).detail;
  $('chosen').textContent = value ?? 'nothing yet';
  const li = document.createElement('li');
  li.textContent = `change → ${value ?? 'null'}`;
  log.prepend(li);
  while (log.children.length > 6) log.lastElementChild!.remove();
});

// The frame's content is the page's own: here, a plain grid of the month's dates, drawn whenever the frame turns
function drawFrame(month: string) {
  const [y, m] = month.split('-').map(Number);
  const cells: string[] = [];
  for (let i = new Date(y, m - 1, 1).getDay(); i > 0; i--) cells.push('<span></span>');
  for (let d = 1, n = new Date(y, m, 0).getDate(); d <= n; d++) cells.push(`<span>${d}</span>`);
  $('frame-days').innerHTML = cells.join('');
}
frame.addEventListener('monthchange', (e) => drawFrame((e as CustomEvent<{ month: string }>).detail.month));
drawFrame(frame.month);
