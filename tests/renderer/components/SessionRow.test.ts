import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionRow from '../../../src/renderer/src/components/SessionRow.vue'
import { makeSession, makeTag } from '../fakeApi'

describe('SessionRow', () => {
  const session = makeSession({ name: 'simba-api', cwd: 'D:\\Projects\\simba\\api' })

  function mountRow(canDrag = true) {
    return mount(SessionRow, {
      props: { session, active: false, tags: [], peer: false, canDrag },
    })
  }

  it('状态点按 status prop 加类名，缺省 idle', () => {
    expect(mountRow().find('.dot').classes()).toContain('idle')
    const wrapper = mount(SessionRow, {
      props: { session, active: false, tags: [], peer: false, canDrag: true, status: 'working' },
    })
    expect(wrapper.find('.dot').classes()).toContain('working')
  })

  it('等你确认时 tooltip 追加一行「等你确认：<提示>」；其他状态不追加', () => {
    const blocked = mount(SessionRow, {
      props: {
        session,
        active: false,
        tags: [],
        peer: false,
        canDrag: true,
        status: 'blocked',
        pendingHint: 'Allow execution?',
      },
    })
    expect(blocked.find('[data-test=session-row]').attributes('title')).toBe(
      `${session.cwd}
等你确认：Allow execution?`,
    )
    const working = mount(SessionRow, {
      props: { session, active: false, tags: [], peer: false, canDrag: true, status: 'working' },
    })
    expect(working.find('[data-test=session-row]').attributes('title')).toBe(session.cwd)
  })

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

  it('行右侧不再有标签色点（挂了标签也没有，标签只进 tooltip「同时在」）；状态点是行的最后一个子元素（右侧），不与分组头的标签色点同一列', () => {
    const wrapper = mount(SessionRow, {
      props: {
        session,
        active: false,
        tags: [makeTag({ name: 'simba', color: '#2F6FDB' }), makeTag({ name: 'java' })],
        peer: false,
        canDrag: true,
        status: 'blocked',
        pendingHint: 'Allow?',
      },
    })
    const row = wrapper.find('[data-test=session-row]')

    expect(wrapper.find('[data-test=row-tags]').exists()).toBe(false)
    expect(wrapper.find('[data-test=row-tag-dot]').exists()).toBe(false)
    expect(row.element.lastElementChild?.classList.contains('dot')).toBe(true)
    expect(row.element.firstElementChild?.classList.contains('dot')).toBe(false)
    expect(row.attributes('title')).toBe(`${session.cwd}
同时在：simba、java
等你确认：Allow?`)
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
