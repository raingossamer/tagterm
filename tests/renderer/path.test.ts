import { describe, expect, it } from 'vitest'
import { pathHead, pathTail } from '../../src/renderer/src/composables/path'

describe('pathTail', () => {
  it('取末两段，兼容正反斜杠与结尾分隔符', () => {
    expect(pathTail('D:\\Projects\\simba\\api')).toBe('simba\\api')
    expect(pathTail('C:/work/iot/')).toBe('work\\iot')
    expect(pathTail('C:\\tools')).toBe('C:\\tools')
  })
})

describe('pathHead', () => {
  it('超过三级的路径只显示盘符与前三段，其余折成省略号', () => {
    expect(pathHead('C:\\Users\\21477\\Desktop\\tagterm')).toBe('C:\\Users\\21477\\Desktop\\…')
    expect(pathHead('C:\\Users\\21477\\Desktop\\Self-Project\\aly-Inform')).toBe(
      'C:\\Users\\21477\\Desktop\\…',
    )
  })

  it('不足三级的路径原样显示（含结尾分隔符与正斜杠）', () => {
    expect(pathHead('D:\\Projects\\simba\\api')).toBe('D:\\Projects\\simba\\api')
    expect(pathHead('C:/work/iot/')).toBe('C:\\work\\iot')
    expect(pathHead('C:\\tools')).toBe('C:\\tools')
    expect(pathHead('')).toBe('')
  })

  it('UNC 路径保留开头的双反斜杠', () => {
    expect(pathHead('\\\\nas\\share\\a\\b\\c')).toBe('\\\\nas\\share\\a\\b\\…')
  })
})
