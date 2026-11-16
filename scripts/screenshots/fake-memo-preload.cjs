/**
 * README 截图用的备忘小窗假后端：按 MemoWindowApi 的形状（memo + memoWindow 两组，与 src/preload/memo.ts 一致）
 * 实现一份内存版 window.tagterm，小窗页面（out/renderer/memo.html 的真实构建产物）照常运行，事项只来自下面的演示数据。
 * 不读写任何用户文件。运行在 sandbox: true 下，只用 contextBridge。
 */
const { contextBridge } = require('electron')

// 演示事项：时间相对截图当天，保证「本周」里有延续来的、新加的和做完的，往周也有做完的
const DAY_MS = 86400000
const daysAgo = (days, hour = 10) => {
  const d = new Date(Date.now() - days * DAY_MS)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}
const T0 = daysAgo(0, 9)
let memos = [
  { id: 'm-1', text: '整理 simba-api 的接口文档', done: false, createdAt: daysAgo(9) },
  { id: 'm-2', text: '让 Claude Code 给 tagterm 的拖拽排序补回归测试', done: false, createdAt: T0 },
  { id: 'm-3', text: '升级 node-pty 后跑一遍烟测', done: false, createdAt: T0 },
  {
    id: 'm-4',
    text: '周会：同步 simba 迭代进度',
    done: true,
    createdAt: daysAgo(2),
    doneAt: daysAgo(0, 8),
  },
  { id: 'm-5', text: '修复托盘图标闪烁', done: true, createdAt: daysAgo(10), doneAt: daysAgo(8) },
]

const bus = {}
const on = (channel) => (cb) => {
  ;(bus[channel] ??= new Set()).add(cb)
  return () => bus[channel].delete(cb)
}
const emit = (channel, ...args) => {
  for (const cb of [...(bus[channel] ?? [])]) cb(...args)
}
const clone = (v) => JSON.parse(JSON.stringify(v))
const ok = (v) => Promise.resolve(v === undefined ? undefined : clone(v))

const api = {
  memo: {
    list: () => ok(memos),
    create: (text) => {
      const m = { id: `m-${Date.now()}`, text: text.trim(), done: false, createdAt: T0 }
      memos = [...memos, m]
      emit('memo:changed', clone(memos))
      return ok(m)
    },
    update: (id, patch) => {
      memos = memos.map((m) => {
        if (m.id !== id) return m
        const next = { ...m, ...patch }
        if (patch.done === true && !m.done) next.doneAt = new Date().toISOString()
        if (patch.done === false) delete next.doneAt
        return next
      })
      emit('memo:changed', clone(memos))
      return ok(memos.find((m) => m.id === id))
    },
    remove: (id) => {
      memos = memos.filter((m) => m.id !== id)
      emit('memo:changed', clone(memos))
      return ok()
    },
    onChanged: on('memo:changed'),
  },
  memoWindow: {
    close: () => {},
    onFocusInput: on('memo-window:focus-input'),
  },
}

contextBridge.exposeInMainWorld('tagterm', api)
