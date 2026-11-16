/**
 * 本周备忘小窗的位置与大小（纯函数，不 import electron）：
 * memo-window.json v1 的解析（坏了就当没记过）、默认位置（主窗口所在屏幕工作区右上角）、记住的位置越界时挪回来。
 * 只记这台机器的屏幕布局，不进配置导出（memo-floating-window 决策 3）。
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const MEMO_WINDOW_FILE_VERSION = 1
export const MEMO_WINDOW_DEFAULT_SIZE = { width: 360, height: 520 }
export const MEMO_WINDOW_MIN_SIZE = { width: 300, height: 260 }
/** 默认位置离工作区边缘的距离 */
const MARGIN = 16
/** 标题栏高度：越界判定只看标题栏抓不抓得到 */
const TITLE_BAR_HEIGHT = 40
/** 标题栏至少露出这么多才算抓得到 */
const MIN_GRAB = { width: 80, height: 20 }

export interface MemoWindowFile {
  version: typeof MEMO_WINDOW_FILE_VERSION
  bounds: Rect
}

const isInt = (v: unknown): v is number => Number.isInteger(v)

/** 版本不认识、缺字段、不是整数、宽高不是正数 → null（由调用方按缺省处理并记警告） */
export function parseMemoWindowFile(raw: unknown): Rect | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const file = raw as Partial<MemoWindowFile>
  if (file.version !== MEMO_WINDOW_FILE_VERSION) return null
  const b = file.bounds as Partial<Rect> | undefined
  if (typeof b !== 'object' || b === null) return null
  if (!isInt(b.x) || !isInt(b.y) || !isInt(b.width) || !isInt(b.height)) return null
  if (b.width <= 0 || b.height <= 0) return null
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/** 标题栏在某块屏幕的工作区里露出够多 → 用户抓得到它 */
function isGrabbable(rect: Rect, workAreas: readonly Rect[]): boolean {
  return workAreas.some(
    (area) =>
      overlap(rect.x, rect.x + rect.width, area.x, area.x + area.width) >= MIN_GRAB.width &&
      overlap(rect.y, rect.y + TITLE_BAR_HEIGHT, area.y, area.y + area.height) >= MIN_GRAB.height,
  )
}

/**
 * 小窗打开时的位置与大小：记住的位置标题栏还抓得到就原样用；没记过或越界（屏幕拔掉了）→ 放到主窗口所在屏幕的
 * 工作区右上角（大小照旧，太大就收进工作区）。大小不小于最小值。
 */
export function placeMemoWindow(input: {
  saved: Rect | null
  workAreas: readonly Rect[]
  mainArea: Rect
}): Rect {
  const { saved, workAreas, mainArea } = input
  const size = {
    width: Math.max(MEMO_WINDOW_MIN_SIZE.width, saved?.width ?? MEMO_WINDOW_DEFAULT_SIZE.width),
    height: Math.max(MEMO_WINDOW_MIN_SIZE.height, saved?.height ?? MEMO_WINDOW_DEFAULT_SIZE.height),
  }
  if (saved && isGrabbable({ ...saved, ...size }, workAreas))
    return { x: saved.x, y: saved.y, ...size }
  const width = Math.max(
    MEMO_WINDOW_MIN_SIZE.width,
    Math.min(size.width, mainArea.width - 2 * MARGIN),
  )
  const height = Math.max(
    MEMO_WINDOW_MIN_SIZE.height,
    Math.min(size.height, mainArea.height - 2 * MARGIN),
  )
  return {
    x: mainArea.x + mainArea.width - MARGIN - width,
    y: mainArea.y + MARGIN,
    width,
    height,
  }
}
