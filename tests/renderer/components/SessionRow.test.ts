import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionRow from '../../../src/renderer/src/components/SessionRow.vue'
import { makeSession } from '../fakeApi'

describe('SessionRow', () => {
  const session = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api' })

  function mountRow(canDrag = true) {
    return mount(SessionRow, {
      props: { session, active: false, tags: [], peer: false, canDrag },
    })
  }

  it('根元素不是 button 但可键盘操作：click / Enter / Space 都发出 select', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('[data-test=session-row]')

    expect(row.element.tagName).not.toBe('BUTTON')
    expect(row.attributes('role')).toBe('button')
    expect(row.attributes('tabindex')).toBe('0')

    await row.trigger('click')
    await row.trigger('keydown', { key: 'Enter' })
    await row.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('select')).toEqual([[session.id], [session.id], [session.id]])
  })

  it('行内没有垃圾桶等按钮（移除会话只在右键菜单里），行文本只有名称与路径末两段', () => {
    const wrapper = mountRow()

    expect(wrapper.find('[data-test=row-remove]').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-test=session-row]').text().replace(/\s+/g, '')).toBe(
      'simba-apisimba\\api',
    )
  })

  it('右键：阻止系统菜单并发出 menu(id, x, y)', () => {
    const wrapper = mountRow()
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 50,
    })

    wrapper.find('[data-test=session-row]').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('menu')).toEqual([[session.id, 40, 50]])
  })

  it('整行可拖：draggable 为真，dragstart / drop / dragend 各上抛一次（不加拖拽手柄）', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('[data-test=session-row]')

    expect(row.attributes('draggable')).toBe('true')
    expect(wrapper.find('[data-test=row-handle]').exists()).toBe(false)

    await row.trigger('dragstart')
    await row.trigger('drop')
    await row.trigger('dragend')
    expect(wrapper.emitted('dragStart')).toEqual([[session.id]])
    expect(wrapper.emitted('dropOn')).toEqual([[session.id]])
    expect(wrapper.emitted('dragEnd')).toEqual([[]])
  })

  it('canDrag 为假（左栏正在搜索）时整行不可拖，但单击照常选中', async () => {
    const wrapper = mountRow(false)
    const row = wrapper.find('[data-test=session-row]')

    expect(row.attributes('draggable')).toBe('false')
    await row.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[session.id]])
  })
})
