/**
 * 可选日期范围（min / max）。预约场景用 min="today"：今天以前的日子不能选。
 *
 * 写法：today、tomorrow、+N（N 天以后）、YYYY-MM-DD。按调用时的本地日期计算。
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 把 min / max 的写法换算成 YYYY-MM-DD；写错了返回 null（等于不限制）。 */
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

/** YYYY-MM-DD 对应的月份序号（年 * 12 + 月），和 deck 里的一致。 */
export function monthIndexOf(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
}

export class DayRange {
  min: string | null = null;
  max: string | null = null;
  private specMin: string | null = null;
  private specMax: string | null = null;

  /** 记下写法并立即换算。today 这类相对写法可以用 refresh() 重新换算（比如过了午夜）。 */
  set(which: 'min' | 'max', spec: string | null): void {
    if (which === 'min') this.specMin = spec;
    else this.specMax = spec;
    this.refresh();
  }

  refresh(now = new Date()): void {
    this.min = resolveDay(this.specMin, now);
    this.max = resolveDay(this.specMax, now);
  }

  /** YYYY-MM-DD 可以字符串比较。 */
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
