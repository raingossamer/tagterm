import { describe, expect, it } from 'vitest'
import { placeMenu } from '../../src/renderer/src/composables/menuPosition'

describe('placeMenu', () => {
  const viewport = { viewportWidth: 800, viewportHeight: 600 }

  it('默认在鼠标位置向右下展开', () => {
    expect(placeMenu({ x: 10, y: 20, width: 140, height: 70, ...viewport })).toEqual({
      left: 10,
      top: 20,
    })
  })

  it('右侧放不下时翻转到鼠标左侧，下方放不下时翻转到上方', () => {
    expect(placeMenu({ x: 700, y: 20, width: 140, height: 70, ...viewport })).toEqual({
      left: 560,
      top: 20,
    })
    expect(placeMenu({ x: 10, y: 580, width: 140, height: 70, ...viewport })).toEqual({
      left: 10,
      top: 510,
    })
  })

  it('翻转后仍越界则贴边不为负', () => {
    expect(placeMenu({ x: 100, y: 30, width: 900, height: 700, ...viewport })).toEqual({
      left: 0,
      top: 0,
    })
  })
})
