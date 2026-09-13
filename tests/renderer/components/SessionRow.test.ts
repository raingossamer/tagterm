import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionRow from '../../../src/renderer/src/components/SessionRow.vue'
import { makeSession } from '../fakeApi'

describe('SessionRow', () => {
  const session = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api' })

  function mountRow() {
    return mount(SessionRow, { props: { session, active: false, tags: [], peer: false } })
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

  it('垃圾桶：tooltip「移除会话」，点击只发出 remove 不发出 select，行文本不受影响', async () => {
    const wrapper = mountRow()
    const del = wrapper.find('[data-test=row-remove]')

    expect(del.attributes('title')).toBe('移除会话')
    await del.trigger('click')
    expect(wrapper.emitted('remove')).toEqual([[session.id]])
    expect(wrapper.emitted('select')).toBeUndefined()
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
})
