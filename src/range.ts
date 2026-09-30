/**
 * Selectable date range (min / max). For bookings use min="today": days before today can't be selected.
 *
 * Syntax: today, tomorrow, +N (N days from now), YYYY-MM-DD. Evaluated against the local date at call time.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Convert a min / max spec to YYYY-MM-DD; returns null for an invalid spec (meaning no limit). */
export function resolveDay(spec: string | null | undefined, now = new Date()): string | null {
  const s = spec?.trim().toLowerCase();
  if (!s) return null;
  let offset: number | null = null;
  if (s === 'today') offset = 0;
  else if (s === 'tomorrow') offset = 1;
  else if (/^\+\d+$/.test(s)) offset = Number(s.slice(1));
  if (offset !== null) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  return m ? `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}` : null;
}

/** Month index (year * 12 + month) for a YYYY-MM-DD, matching the one used in the deck. */
export function monthIndexOf(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
}

export class DayRange {
  min: string | null = null;
  max: string | null = null;
  private specMin: string | null = null;
  private specMax: string | null = null;

  /** Store the spec and resolve it right away. Relative specs such as today can be re-resolved with refresh() (e.g. after midnight). */
  set(which: 'min' | 'max', spec: string | null): void {
    if (which === 'min') this.specMin = spec;
    else this.specMax = spec;
    this.refresh();
  }

  refresh(now = new Date()): void {
    this.min = resolveDay(this.specMin, now);
    this.max = resolveDay(this.specMax, now);
  }

  /** YYYY-MM-DD strings compare correctly as strings. */
  allows(key: string): boolean {
    return !(this.min && key < this.min) && !(this.max && key > this.max);
  }

  get minMonth(): number {
    return this.min ? monthIndexOf(this.min) : -Infinity;
  }

  get maxMonth(): number {
    return this.max ? monthIndexOf(this.max) : Infinity;
  }
}
