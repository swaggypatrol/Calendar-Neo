import '../src/index';
import type { RetroCalendar } from '../src/index';

const $ = (id: string) => document.getElementById(id)!;
const cal = $('cal') as RetroCalendar;

function pick(groupId: string, attr: string, apply: (v: string) => void) {
  const group = $(groupId);
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    apply(btn.dataset[attr]!);
  });
}

pick('min', 'min', (v) => (v ? cal.setAttribute('min', v) : cal.removeAttribute('min')));
pick('lang', 'lang', (v) => cal.setAttribute('locale', v));
pick('week', 'ws', (v) => cal.setAttribute('week-start', v));

const log = $('log');
cal.addEventListener('change', (e) => {
  const { value } = (e as CustomEvent<{ value: string | null }>).detail;
  $('chosen').textContent = value ?? 'nothing yet';
  const li = document.createElement('li');
  li.textContent = `change → ${value ?? 'null'}`;
  log.prepend(li);
  while (log.children.length > 6) log.lastElementChild!.remove();
});
