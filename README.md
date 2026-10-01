# Calendar Neo

**English** · [简体中文](README.zh-CN.md)

> A date picker you paint, not click. Swipe a highlighter across the days you want, and it figures out the rest. Scribblers, zig-zaggers, and people who hold the pen still for no reason: you'll all get your dates.

Calendar Neo is a set of framework-free Web Components. Instead of picking a start date and an end date, you draw over the days you want with a highlighter, as you would on a paper calendar. It works with a mouse, a finger or a pen, and drops into plain HTML, React, Vue or anything else that renders DOM.

The result is simply a list of dates, so continuous ranges, several ranges and scattered single days all work the same way.

## Components

| Element | What it is |
| --- | --- |
| `<highlighter-calendar>` | One month you can paint on. The core of everything else. |
| `<highlighter-book>` | An open spiral-bound paper calendar: two months side by side, pages printed on both sides, turned with a soft page curl, with a highlighter and an eraser tucked into the coil. |
| `<highlighter-picker>` | A booking-style date field. A narrow pill that grows into the paper calendar and summarises what you picked. |
| `<highlighter-deck>` | An earlier multi-month layout: a stack of month cards you swipe through. |

## How painting works

- **Swipe with the left button or a finger** to highlight. Behind every date is an 8×8 grid of cells; once enough of them are painted (`threshold`, default 35 of 64) the date is selected.
- **Swipe with the right button** (or a pen's eraser end) to erase, which is the same logic in reverse. On touch screens, pick up the eraser from the book's coil, or set `tool="erase"`.
- **Hold still** and the ink soaks in and darkens under the pen. Hold long enough and the day gets a stroke drawn across it. Pressing between two numbers bleeds halfway into the neighbour first, and keeps going only if you keep holding. Bleeding never crosses into the row above or below.
- **Go back and forth** over the same spot and the colour builds up, to a limit.
- **Paint anywhere** in a cell while drawing. When you lift the pen, the strokes glide into a tidy band centred on the date numbers (0.618 of the cell height), with a clean pass laid underneath, so the result looks consistent.
- Dates that didn't reach the threshold fade out when you lift the pen. Selected dates that were only partly covered get their stroke finished for you.
- **Click** a date to select it (right-click to clear it). Keyboard: arrow keys move, Space / Enter toggle, PageUp / PageDown change month.

## The paper calendar: `<highlighter-book>`

- Two months are always open, one per page. Each sheet is printed on both sides, like a real book.
- **Spiral binding.** Every sheet is punched down its inner edge and hangs on a metal coil in the middle of the book, and every turn swings round that coil. A highlighter is pushed into the coil from the top and an eraser from the bottom. Tap one to pick it up: it slides a little further out of the coil and becomes what the left button or a finger does, and the book fires `toolchange`. Both are 1/φ² as thick as the coil, so the strip of paper inside the holes slips past them as a sheet turns: they never get in its way.
- **Turn pages** by dragging on any blank area (outside the date grid), or with a two-finger sideways swipe on a trackpad: drag left and the right page peels up from its corner and follows your finger; drag right to turn back. Drag past about a third, or flick, and it turns; otherwise it settles back. Either way the page carries on with the speed you gave it, slows down naturally and lands exactly flat, with no bounce, pause or snap, and a page that is still moving can be caught again. Swipe quickly several times and it riffles through pages. The right page's bottom corner rests slightly peeled back and gently breathing; it is the real sheet, so clicking or pulling it (or its folded-over flap) continues the same curl into a full turn.
- **Bookmarks** replace any kind of glow. Every month with selected days gets a bookmark tab on the fore-edge, showing how many days you picked there (1 to 5+). Months you have already turned past sit on the left, months ahead sit on the right. Click a tab to turn straight to that month, and the tab slides into the page as a hanging ribbon. When its sheet turns over, a bookmark fades out and comes back on the other side instead of sliding across the open pages.
- **Golden proportions** throughout. Page margins are 1 : φ (outer edge : binding side). In the day grid the numbers are 1/φ² of a cell's height, the month title is φ times the numbers and the highlight band is 1/φ of a cell. The coil's hole spacing, hole size and inset are all related by φ, and the highlighter and eraser meet at the golden section of the spine. A tab is t × tφ, a ribbon t × tφ², and each month's tab sits frac(n·φ) of the way down the fore-edge: the golden-ratio sequence, which keeps any handful of bookmarks evenly spread.
- Past months are printed with a soft vignette.
- Everything animates. Nothing jumps.

## The booking field: `<highlighter-picker>`

A narrow pill that shows today's date. Click it and it grows smoothly into the paper calendar, and the corner of the right page lifts a little to hint that it can be turned. Click outside or press Esc to fold it back.

Once you've picked dates, the pill shows them, for example `Nov 14 – Dec 11`. Pick more than one range and it becomes a small wheel you can drag, scroll or step through; clicking it opens the calendar at that range.

## Future-only booking

Add `min="today"` (and optionally `max`) for customer bookings. Days outside the range are greyed out and the highlighter leaves no ink on them, so you can drag from last week into next week and the past days are simply skipped. The book won't turn to months that are entirely out of range.

```html
<highlighter-picker min="today" max="+90"></highlighter-picker>
```

`min` / `max` accept `today`, `tomorrow`, `+N` (N days from today) or `YYYY-MM-DD`. Relative values are re-evaluated whenever the calendar redraws. Selected dates that fall outside the range are removed and a `change` event fires.

## Usage

```html
<script type="module" src="highlighter-calendar.js"></script>

<highlighter-picker week-start="1" color="#ffd21f"></highlighter-picker>

<script>
  const picker = document.querySelector('highlighter-picker');
  picker.addEventListener('change', (e) => console.log(e.detail.value)); // ['2026-09-03', ...]
  picker.value = ['2026-09-10', '2026-09-11'];
</script>
```

All components share these attributes:

| Attribute | Meaning |
| --- | --- |
| `month` | Month to show, `YYYY-MM` (for the book: the left page) |
| `threshold` | How many of the 64 cells must be painted to select a date, default 35 |
| `week-start` | `1` Monday first (default), `0` Sunday first |
| `locale` | Language for month and weekday names, defaults to the browser |
| `color` | Highlighter colour, default `#ffd21f` |
| `tool` | Tool for the left button / touch: `highlight` (default) or `erase` |
| `brush-size` | Brush size multiplier, 0.5–2 |
| `hold-delay` | How long (ms) the pen must rest before it counts as holding, default 320 |
| `value` | Initially selected dates, comma separated |
| `min`, `max` | Selectable range (see above) |
| `theme` | `light` or `dark` to override the system colour scheme; leave it out to follow the system |

Events: `input` (fires as each day is selected or cleared while drawing) and `change` (after you lift the pen, if anything changed), both with `detail: { value, added, removed }`; `monthchange` when the visible month changes; `toolchange` (book and picker, `detail: { tool }`) when the highlighter or the eraser is picked up from the coil.

Methods: `clear()`; on the book `next()` / `prev()` / `show(month)`; on the picker `open()` / `close()`.

## Running the demo

```bash
npm install
npm run dev          # http://localhost:5173 (the sun / moon button switches day and night)
npm run dev:booking  # future-only demo: http://localhost:5173/booking.html
npm test             # unit tests for the selection logic
npm run build        # library build into dist/
```

## Project layout

- `src/engine.ts`: selection logic (8×8 cells, threshold, hold-to-bleed, eraser). No DOM, unit tested.
- `src/ink.ts`: the highlighter look (bristles, streaks, layering, fading, settling into the band, auto-completed strokes).
- `src/calendar.ts`: the `<highlighter-calendar>` element, wiring the two to pointer, keyboard and the month grid.
- `src/book.ts`: the paper calendar (two pages, spiral binding with the highlighter and eraser, page curl, bookmarks).
- `src/picker.ts`: the booking field (pill, grow animation, range wheel).
- `src/deck.ts`: the card-stack layout.
- `src/range.ts`: `min` / `max` handling.
- `index.html` + `demo/`: demo page; `booking.html` + `demo/booking.ts`: future-only demo.

## License

[Mozilla Public License 2.0](LICENSE).
