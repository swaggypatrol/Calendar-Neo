/**
 * Day / night toggle for the demo pages. It sets data-theme on <html> for the page itself and a theme
 * attribute on every calendar component, and cross-fades the switch where the browser supports
 * view transitions.
 */

const KEY = 'calendar-neo-theme';
const system = matchMedia('(prefers-color-scheme: dark)');
const SUN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

type Theme = 'light' | 'dark';

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function current(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : system.matches ? 'dark' : 'light';
}

function apply(t: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t;
  for (const el of document.querySelectorAll('highlighter-picker, highlighter-book, highlighter-deck, highlighter-calendar, retro-calendar, retro-picker')) {
    el.setAttribute('theme', t);
  }
  const btn = document.getElementById('theme');
  if (btn) {
    btn.innerHTML = t === 'dark' ? SUN : MOON;
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to day mode' : 'Switch to night mode');
    btn.title = btn.getAttribute('aria-label')!;
  }
}

const btn = document.createElement('button');
btn.id = 'theme';
btn.type = 'button';
btn.className = 'theme-toggle';
document.body.append(btn);
apply(saved() ?? current());

btn.addEventListener('click', () => {
  const next: Theme = current() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private mode or blocked storage: the toggle still works for this visit
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(() => apply(next));
  else apply(next);
});
