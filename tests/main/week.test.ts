import { describe, expect, it } from 'vitest'
import {
  addWeeks,
  carriedFromLabel,
  earliestMemoWeek,
  isoWeekOf,
  memosOfWeek,
  weekLabel,
  weekStart,
} from '@shared/week'
import type { MemoItem } from '@shared/models'

/** 本地时间构造：测试与机器时区无关 */
const at = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)
const iso = (date: Date): string => date.toISOString()

describe('ISO 周号（周一起，本地时间）', () => {
  it('2026-11-06 周五属于 2026 W45，周起点是 11/2 周一 00:00', () => {
    expect(isoWeekOf(at(2026, 11, 6))).toEqual({ year: 2026, week: 45 })
    const start = weekStart({ year: 2026, week: 45 })
    expect([start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours()]).toEqual([
      2026, 11, 2, 0,
    ])
  })

  it('周日深夜仍是本周，周一零点进入下一周', () => {
    expect(isoWeekOf(at(2026, 11, 8, 23, 59))).toEqual({ year: 2026, week: 45 })
    expect(isoWeekOf(at(2026, 11, 9, 0, 0))).toEqual({ year: 2026, week: 46 })
  })

  it('跨年：2026 有 53 周，2027-01-01 仍属 2026 W53；2024-12-30 属 2025 W1', () => {
    expect(isoWeekOf(at(2026, 12, 31))).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf(at(2027, 1, 1))).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf(at(2027, 1, 4))).toEqual({ year: 2027, week: 1 })
    expect(isoWeekOf(at(2024, 12, 30))).toEqual({ year: 2025, week: 1 })
  })

  it('翻周跨年：W53 的下一周是次年 W1，反之亦然', () => {
    expect(addWeeks({ year: 2026, week: 53 }, 1)).toEqual({ year: 2027, week: 1 })
    expect(addWeeks({ year: 2027, week: 1 }, -1)).toEqual({ year: 2026, week: 53 })
    expect(addWeeks({ year: 2026, week: 45 }, -2)).toEqual({ year: 2026, week: 43 })
  })

  it('标题：本年只写周号与起止日期，别的年份前面带年份', () => {
    const now = at(2026, 11, 6)
    expect(weekLabel({ year: 2026, week: 45 }, now)).toBe('W45（11/2–11/8）')
    expect(weekLabel({ year: 2026, week: 53 }, now)).toBe('W53（12/28–1/3）')
    expect(weekLabel({ year: 2025, week: 52 }, now)).toBe('2025 W52（12/22–12/28）')
  })
})

describe('备忘事项的归属：未完成一律在本周，已完成按完成时间归周', () => {
  const now = at(2026, 11, 6)
  const item = (over: Partial<MemoItem> & Pick<MemoItem, 'id'>): MemoItem => ({
    text: over.id,
    done: false,
    createdAt: iso(at(2026, 11, 3)),
    ...over,
  })
  const carried = item({ id: '上周没做完', createdAt: iso(at(2026, 10, 28)) })
  const doneLastWeek = item({
    id: '上周做完',
    createdAt: iso(at(2026, 10, 27)),
    done: true,
    doneAt: iso(at(2026, 10, 30)),
  })
  const doneThisWeek = item({ id: '本周做完', done: true, doneAt: iso(at(2026, 11, 4)) })
  const fresh = item({ id: '本周新加', createdAt: iso(at(2026, 11, 5)) })
  const items = [fresh, doneThisWeek, doneLastWeek, carried]

  it('本周：未完成按创建时间先后（延续来的在前），已完成按完成时间沉底；上周做完的不在本周', () => {
    expect(memosOfWeek(items, { year: 2026, week: 45 }, now).map((m) => m.id)).toEqual([
      '上周没做完',
      '本周新加',
      '本周做完',
    ])
  })

  it('往周：只有那一周做完的，没做完的已经延续到本周、不重复出现', () => {
    expect(memosOfWeek(items, { year: 2026, week: 44 }, now).map((m) => m.id)).toEqual(['上周做完'])
  })

  it('「自 Wxx」只标在创建于往周、还没做完的事项上', () => {
    expect(carriedFromLabel(carried, now)).toBe('W44')
    expect(carriedFromLabel(fresh, now)).toBeNull()
    expect(carriedFromLabel(doneLastWeek, now)).toBeNull()
    expect(carriedFromLabel(item({ id: 'old', createdAt: iso(at(2025, 12, 24)) }), now)).toBe(
      '2025 W52',
    )
  })

  it('往周最早翻到有完成事项的那一周；没有往周记录时就是本周', () => {
    expect(earliestMemoWeek(items, now)).toEqual({ year: 2026, week: 44 })
    expect(earliestMemoWeek([fresh, carried], now)).toEqual({ year: 2026, week: 45 })
  })
})
