/**
 * 终端字号的范围与夹紧（两进程共用）：渲染进程的终端字号用它，主进程校验导入的配置文件时也用。
 * 字号本身存渲染进程 localStorage，不进 settings.json。
 */
export const DEFAULT_FONT_SIZE = 14
export const MIN_FONT_SIZE = 10
export const MAX_FONT_SIZE = 32

/** 取整并夹到 10–32；不是有限数回落默认 */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)))
}

/** 配置文件里的字号：必须是范围内的整数 */
export function isValidFontSize(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= MIN_FONT_SIZE &&
    (value as number) <= MAX_FONT_SIZE
  )
}
