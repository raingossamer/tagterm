/**
 * 本周备忘的周与归属（两进程共用的纯函数，不 import electron / node / vue）。
 * 周按 ISO 8601：周一起，含 1 月 4 日的那一周是第 1 周；一律用本机本地时间。
 * 归属规则：未完成的事项一律属于本周（创建于往周的标「自 Wxx」），已完成的属于 doneAt 所在周。
 */
import type { MemoItem } from './models'

export interface IsoWeek {
  year: number
  week: number
}

const DAY_MS = 86_400_000

/** 本地日期 → 以 UTC 零点表示的「纯日期」，日期算术不受夏令时影响 */
function dayOf(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 周一 = 0 … 周日 = 6 */
function weekdayOf(utcDay: number): number {
  return (new Date(utcDay).getUTCDay() + 6) % 7
}

/** 某 ISO 年第 1 周周一的纯日期 */
function firstMonday(year: number): number {
  const jan4 = Date.UTC(year, 0, 4)
  return jan4 - weekdayOf(jan4) * DAY_MS
}

export function isoWeekOf(date: Date): IsoWeek {
  const day = dayOf(date)
  // 本周的周四所在的年份就是 ISO 年
  const thursday = day + (3 - weekdayOf(day)) * DAY_MS
  const year = new Date(thursday).getUTCFullYear()
  return { year, week: Math.round((thursday - firstMonday(year)) / (7 * DAY_MS)) + 1 }
}

function mondayOf(w: IsoWeek): number {
  return firstMonday(w.year) + (w.week - 1) * 7 * DAY_MS
}

/** 周一 00:00（本地时间） */
export function weekStart(w: IsoWeek): Date {
  const monday = new Date(mondayOf(w))
  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate())
}

export function addWeeks(w: IsoWeek, n: number): IsoWeek {
  const monday = new Date(mondayOf(w) + n * 7 * DAY_MS)
  return isoWeekOf(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()))
}

export function compareWeeks(a: IsoWeek, b: IsoWeek): number {
  return a.year !== b.year ? a.year - b.year : a.week - b.week
}

/** 「W44」；不是 now 所在的 ISO 年时带年份「2025 W52」 */
export function weekName(w: IsoWeek, now: Date): string {
  return w.year === isoWeekOf(now).year ? `W${w.week}` : `${w.year} W${w.week}`
}

/** 弹窗标题里的周：「W45（11/2–11/8）」 */
export function weekLabel(w: IsoWeek, now: Date): string {
  const monday = mondayOf(w)
  const md = (utcDay: number): string => {
    const d = new Date(utcDay)
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  }
  return `${weekName(w, now)}（${md(monday)}–${md(monday + 6 * DAY_MS)}）`
}

/** 事项归属的周：未完成 → now 所在周；已完成 → doneAt 所在周 */
export function memoWeekOf(item: MemoItem, now: Date): IsoWeek {
  return isoWeekOf(item.done && item.doneAt ? new Date(item.doneAt) : now)
}

/** 某一周的清单：未完成按创建时间先后在前，已完成按完成时间先后沉底 */
export function memosOfWeek(items: readonly MemoItem[], w: IsoWeek, now: Date): MemoItem[] {
  const inWeek = items.filter((m) => compareWeeks(memoWeekOf(m, now), w) === 0)
  const open = inWeek.filter((m) => !m.done).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const done = inWeek
    .filter((m) => m.done)
    .sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? ''))
  return [...open, ...done]
}

/** 「自 Wxx」：只给创建于往周、还没做完的事项；否则 null */
export function carriedFromLabel(item: MemoItem, now: Date): string | null {
  if (item.done) return null
  const created = isoWeekOf(new Date(item.createdAt))
  return compareWeeks(created, isoWeekOf(now)) < 0 ? weekName(created, now) : null
}

/** 往周最早能翻到的那一周（有完成事项的最早一周）；没有往周记录时就是本周 */
export function earliestMemoWeek(items: readonly MemoItem[], now: Date): IsoWeek {
  let earliest = isoWeekOf(now)
  for (const m of items) {
    const w = memoWeekOf(m, now)
    if (compareWeeks(w, earliest) < 0) earliest = w
  }
  return earliest
}
