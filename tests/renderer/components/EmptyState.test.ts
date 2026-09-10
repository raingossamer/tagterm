import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '../../../src/renderer/src/components/EmptyState.vue'

describe('EmptyState', () => {
  it('显示原型的空状态三行文案', () => {
    const wrapper = mount(EmptyState)

    expect(wrapper.find('[data-test=empty-title]').text()).toBe('选一个会话开始')
    expect(wrapper.text()).toContain(
      '左侧每一行都是一个固定路径的 cmd，一个会话可以同时挂在多个标签下。',
    )
    expect(wrapper.text()).toContain(
      '点击行即打开，终端里输入 claude、gemini 或 codex 唤起对应工具。',
    )
  })
})
