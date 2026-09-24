import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { BackgroundImageData } from '@shared/ipc'
import { DEFAULT_BACKGROUND } from '@shared/models'
import SettingsModal from '../../../src/renderer/src/components/SettingsModal.vue'
import { useSettingsStore } from '../../../src/renderer/src/stores/settings'
import { useUpdateStore } from '../../../src/renderer/src/stores/update'
import { useConfirmStore } from '../../../src/renderer/src/stores/confirm'
import { installFakeWorkspace } from '../fakeWorkspace'
import { installFakeApi, makeImageData, makeSettings, stubObjectUrls } from '../fakeApi'

describe('SettingsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    stubObjectUrls()
  })

  /** 让 store 处于「已保存一张背景图」的状态（背景图是 store 建好的 blob: URL） */
  async function withSavedImage() {
    const store = useSettingsStore()
    store.settings = makeSettings({
      background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/wall/雪山.png' },
    })
    store.backgroundImage = 'blob:mock-saved'
    return store
  }

  it('左侧六段导航：缺省停在「外观」，点击切换内容区', async () => {
    installFakeApi()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    expect(wrapper.findAll('.nav-item').map((n) => n.text())).toEqual([
      '外观',
      '启动',
      'Agent',
      '更新',
      '导入导出',
      '关于',
    ])
    expect(wrapper.find('[data-test=appearance-section]').exists()).toBe(true)

    await wrapper.find('[data-test=settings-nav-startup]').trigger('click')
    expect(wrapper.find('[data-test=appearance-section]').exists()).toBe(false)
    expect(wrapper.find('[data-test=auto-launch-section]').exists()).toBe(true)

    await wrapper.find('[data-test=settings-nav-about]').trigger('click')
    expect(wrapper.find('[data-test=about-version]').exists()).toBe(true)
  })

  it('外观段：无图时滑块置灰；「更换图片」把选中的图进草稿并整窗预览，但不落盘', async () => {
    const api = installFakeApi({
      app: { pickImage: vi.fn(async () => 'D:/wall/雪山.png') },
      settings: { readBackgroundImage: vi.fn(async () => makeImageData('AAA')) },
    })
    const urls = stubObjectUrls()
    const store = useSettingsStore()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    expect(wrapper.find('[data-test=bg-name]').text()).toBe('未设置背景')
    expect(
      (wrapper.find('[data-test=bg-image-opacity]').element as HTMLInputElement).disabled,
    ).toBe(true)

    await wrapper.find('[data-test=bg-pick]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test=bg-name]').text()).toBe('雪山.png')
    expect(store.background.imagePath).toBe('D:/wall/雪山.png') // 预览：整窗立刻生效
    expect(store.backgroundImage).toBe(urls.created[0])
    expect(api.settings.update).not.toHaveBeenCalled() // 但没落盘
    expect(
      (wrapper.find('[data-test=bg-image-opacity]').element as HTMLInputElement).disabled,
    ).toBe(false)
  })

  it('三个滑块与显示方式改动只进草稿并实时预览；「保存设置」一次提交并关闭', async () => {
    const api = installFakeApi()
    const store = await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    await wrapper.find('[data-test=bg-fit]').setValue('cover')
    await wrapper.find('[data-test=bg-image-opacity]').setValue('20')
    await wrapper.find('[data-test=bg-panel-opacity]').setValue('90')
    await wrapper.find('[data-test=bg-blur]').setValue('12')
    await flushPromises()

    expect(wrapper.find('[data-test=bg-image-opacity-value]').text()).toBe('20%')
    expect(wrapper.find('[data-test=bg-panel-opacity-value]').text()).toBe('90%')
    expect(wrapper.find('[data-test=bg-blur-value]').text()).toBe('12 px')
    expect(store.background).toMatchObject({
      fit: 'cover',
      imageOpacity: 0.2,
      panelOpacity: 0.9,
      blurPx: 12,
    })
    expect(api.settings.update).not.toHaveBeenCalled()

    await wrapper.find('[data-test=settings-save]').trigger('click')
    await flushPromises()
    expect(api.settings.update).toHaveBeenCalledWith({
      background: {
        imagePath: 'D:/wall/雪山.png',
        fit: 'cover',
        imageOpacity: 0.2,
        panelOpacity: 0.9,
        blurPx: 12,
      },
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('显示方式的说明随选项变化', async () => {
    installFakeApi()
    await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()
    const hint = () => wrapper.find('[data-test=bg-fit-hint]').text()

    expect(hint()).toBe('保留整张图片，空白区域使用主题底色')
    await wrapper.find('[data-test=bg-fit]').setValue('cover')
    expect(hint()).toBe('等比放大铺满窗口，超出的部分裁掉')
    await wrapper.find('[data-test=bg-fit]').setValue('tile')
    expect(hint()).toBe('按原始尺寸重复铺满窗口')
  })

  it('「取消」与 Esc 丢弃草稿：整窗还原为已保存值，不调 SDK', async () => {
    const api = installFakeApi()
    const store = await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    await wrapper.find('[data-test=bg-blur]').setValue('18')
    await flushPromises()
    expect(store.background.blurPx).toBe(18)

    await wrapper.find('[data-test=settings-cancel]').trigger('click')
    await flushPromises()
    expect(store.background).toEqual({ ...DEFAULT_BACKGROUND, imagePath: 'D:/wall/雪山.png' })
    expect(api.settings.update).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)

    const second = mount(SettingsModal)
    await flushPromises()
    await second.find('[data-test=bg-blur]').setValue('18')
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(store.background.blurPx).toBe(DEFAULT_BACKGROUND.blurPx)
    expect(second.emitted('close')).toHaveLength(1)
  })

  it('关掉「实时预览」后整窗回到已保存值，弹窗内缩略图仍看草稿（自己建的 blob: URL，关弹窗时收掉）', async () => {
    installFakeApi({
      settings: { readBackgroundImage: vi.fn(async () => makeImageData('DRAFT')) },
    })
    const urls = stubObjectUrls()
    const store = await withSavedImage()
    const wrapper = mount(SettingsModal)
    await flushPromises()

    await wrapper.find('[data-test=bg-blur]').setValue('16')
    await flushPromises()
    expect(store.background.blurPx).toBe(16)

    await wrapper.find('[data-test=live-preview]').setValue(false)
    await flushPromises()
    expect(store.background.blurPx).toBe(DEFAULT_BACKGROUND.blurPx) // 整窗回到已保存值
    const draftUrl = wrapper.find('[data-test=bg-thumb] img').attributes('src')
    expect(draftUrl).toMatch(/^blob:/)
    expect(draftUrl).toBe(urls.created.at(-1)) // 最后建的那个是草稿图（整窗那张由 store 在预览时建）
    expect(draftUrl).not.toBe(store.backgroundImage) // 草稿图与整窗生效的图各自一份

    const revokedBefore = urls.revoked.length
    wrapper.unmount()
    expect(urls.revoked.slice(revokedBefore)).toEqual([draftUrl]) // 关弹窗只收掉草稿的 URL；整窗那张不归它管
    expect(urls.revoked).not.toContain(store.backgroundImage)
  })

  describe('背景图读不出来（太大、格式不支持）', () => {
    const TOO_BIG = '背景图片太大（40 MB），请换一张小于 30 MB 的'
    const unreadable = vi.fn(async (_path?: string): Promise<BackgroundImageData | null> => {
      throw new Error(TOO_BIG)
    })

    it('已保存的图读不出来：缩略图下写明原因（不说「不存在」）；「取消」/ Esc 照常关闭', async () => {
      installFakeApi({
        settings: {
          get: async () =>
            makeSettings({ background: { ...DEFAULT_BACKGROUND, imagePath: 'D:/wall/huge.png' } }),
          readBackgroundImage: unreadable,
        },
      })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await useSettingsStore().load()
      const wrapper = mount(SettingsModal)
      await flushPromises()

      expect(wrapper.find('[data-test=bg-error]').text()).toBe(TOO_BIG)
      expect(wrapper.find('[data-test=bg-missing]').exists()).toBe(false)
      await wrapper.find('[data-test=settings-cancel]').trigger('click')
      await flushPromises()
      expect(wrapper.emitted('close')).toHaveLength(1)

      const second = mount(SettingsModal)
      await flushPromises()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(second.emitted('close')).toHaveLength(1)
      vi.restoreAllMocks()
    })

    it('换了一张读不出来的图：整窗回退纯色、缩略图下写明原因；「保存设置」被主进程拒绝 → 底部红字、不关；关掉实时预览同样写明原因', async () => {
      const api = installFakeApi({
        app: { pickImage: vi.fn(async () => 'D:/wall/huge.png') },
        settings: {
          readBackgroundImage: unreadable,
          update: vi.fn(async () => {
            throw new Error(TOO_BIG)
          }),
        },
      })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const store = useSettingsStore()
      const wrapper = mount(SettingsModal)
      await flushPromises()

      await wrapper.find('[data-test=bg-pick]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test=bg-name]').text()).toBe('huge.png')
      expect(store.backgroundImage).toBeNull()
      expect(wrapper.find('[data-test=bg-error]').text()).toBe(TOO_BIG)
      expect(wrapper.find('[data-test=bg-missing]').exists()).toBe(false)
      expect(wrapper.find('[data-test=settings-error]').exists()).toBe(false)

      await wrapper.find('[data-test=settings-save]').trigger('click')
      await flushPromises()
      expect(api.settings.update).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[data-test=settings-error]').text()).toBe(TOO_BIG)
      expect(wrapper.emitted('close')).toBeUndefined()

      await wrapper.find('[data-test=live-preview]').setValue(false)
      await flushPromises()
      expect(wrapper.find('[data-test=bg-thumb] img').exists()).toBe(false)
      expect(wrapper.find('[data-test=bg-error]').text()).toBe(TOO_BIG)
      vi.restoreAllMocks()
    })
  })

  it('「启动」段：复选框反映登录项状态并标注即时生效；改动即 setAutoLaunch 并按返回回填；失败红字并还原', async () => {
    const api = installFakeApi({
      app: {
        getAutoLaunch: vi.fn(async () => ({ enabled: true, blockedBySystem: true })),
        setAutoLaunch: vi.fn(async (enabled: boolean) => ({ enabled, blockedBySystem: false })),
      },
    })
    const wrapper = mount(SettingsModal)
    await flushPromises()
    await wrapper.find('[data-test=settings-nav-startup]').trigger('click')
    const box = () => wrapper.find('[data-test=auto-launch]').element as HTMLInputElement

    expect(wrapper.find('[data-test=auto-launch-label]').text()).toBe('开机时自动启动 TagTerm')
    expect(wrapper.find('[data-test=auto-launch-instant]').text()).toContain('即时生效')
    expect(box().checked).toBe(true)
    expect(wrapper.find('[data-test=auto-launch-blocked]').text()).toBe(
      '已在系统「启动应用」中被禁用',
    )

    await wrapper.find('[data-test=auto-launch]').setValue(false)
    await flushPromises()
    expect(api.app.setAutoLaunch).toHaveBeenCalledWith(false)
    expect(box().checked).toBe(false)
    expect(wrapper.find('[data-test=auto-launch-blocked]').exists()).toBe(false)

    vi.mocked(api.app.setAutoLaunch).mockRejectedValueOnce(new Error('开发模式下不能设置开机自启'))
    await wrapper.find('[data-test=auto-launch]').setValue(true)
    await flushPromises()
    expect(box().checked).toBe(false)
    expect(wrapper.find('[data-test=settings-error]').text()).toBe('开发模式下不能设置开机自启')
  })

  describe('「启动」段 · 全局快捷键', () => {
    async function openStartup() {
      const wrapper = mount(SettingsModal, { attachTo: document.body })
      await flushPromises()
      await wrapper.find('[data-test=settings-nav-startup]').trigger('click')
      return wrapper
    }
    const keyBox = (w: ReturnType<typeof mount>) => w.find('[data-test=global-shortcut-key]')
    const pressKey = (w: ReturnType<typeof mount>, init: KeyboardEventInit) =>
      keyBox(w).trigger('keydown', init)

    it('显示开关与当前键位，说明怎么用；已注册时没有红字', async () => {
      installFakeApi()
      const wrapper = await openStartup()
      const box = wrapper.find('[data-test=global-shortcut-enabled]').element as HTMLInputElement
      expect(box.checked).toBe(true)
      expect(wrapper.find('[data-test=global-shortcut-label]').text()).toBe(
        '全局快捷键唤出 / 隐藏窗口',
      )
      expect(keyBox(wrapper).text()).toBe('Ctrl+Alt+T')
      expect(wrapper.find('[data-test=global-shortcut-hint]').text()).toContain('Esc 取消')
      expect(wrapper.find('[data-test=global-shortcut-error]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('启动时没注册上（被别的程序占着）→ 键位框下红字「该快捷键已被其他程序占用，换一个组合」', async () => {
      installFakeApi({
        app: {
          getGlobalShortcut: vi.fn(async () => ({
            enabled: true,
            accelerator: 'Ctrl+Alt+T',
            registered: false,
          })),
        },
      })
      const wrapper = await openStartup()
      expect(wrapper.find('[data-test=global-shortcut-error]').text()).toBe(
        '该快捷键已被其他程序占用，换一个组合',
      )
      wrapper.unmount()
    })

    it('点键位框开始录制：先暂停当前热键，框里提示「按下新的组合键…」；只按修饰键继续等，按下合法组合即提交并回填', async () => {
      const api = installFakeApi()
      const wrapper = await openStartup()
      await keyBox(wrapper).trigger('click')
      expect(api.app.pauseGlobalShortcut).toHaveBeenCalledWith(true)
      expect(keyBox(wrapper).text()).toBe('按下新的组合键…')

      await pressKey(wrapper, { key: 'Control', code: 'ControlLeft', ctrlKey: true })
      expect(api.app.setGlobalShortcut).not.toHaveBeenCalled()
      await pressKey(wrapper, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })
      await flushPromises()
      expect(api.app.pauseGlobalShortcut).toHaveBeenLastCalledWith(false)
      expect(api.app.setGlobalShortcut).toHaveBeenCalledWith({
        enabled: true,
        accelerator: 'Ctrl+Alt+K',
      })
      expect(keyBox(wrapper).text()).toBe('Ctrl+Alt+K')
      wrapper.unmount()
    })

    it('录制中按了不合法的组合 → 提示规则、继续录；Esc 只取消录制（恢复热键、不关弹窗）；失焦同样取消', async () => {
      const api = installFakeApi()
      const wrapper = await openStartup()
      await keyBox(wrapper).trigger('click')
      await pressKey(wrapper, { key: 't', code: 'KeyT', shiftKey: true })
      expect(wrapper.find('[data-test=global-shortcut-error]').text()).toBe(
        '需要包含 Ctrl 或 Alt，再加字母、数字或 F1–F12',
      )
      expect(keyBox(wrapper).text()).toBe('按下新的组合键…')

      await pressKey(wrapper, { key: 'Escape', code: 'Escape' })
      await flushPromises()
      expect(wrapper.find('[data-test=settings-modal]').exists()).toBe(true)
      expect(wrapper.emitted('close')).toBeUndefined()
      expect(api.app.pauseGlobalShortcut).toHaveBeenLastCalledWith(false)
      expect(keyBox(wrapper).text()).toBe('Ctrl+Alt+T')
      expect(api.app.setGlobalShortcut).not.toHaveBeenCalled()

      await keyBox(wrapper).trigger('click')
      await keyBox(wrapper).trigger('blur')
      await flushPromises()
      expect(api.app.pauseGlobalShortcut).toHaveBeenLastCalledWith(false)
      expect(keyBox(wrapper).text()).toBe('Ctrl+Alt+T')
      wrapper.unmount()
    })

    it('新键位被占用：红字显示原因，键位框仍是旧键位', async () => {
      const api = installFakeApi()
      vi.mocked(api.app.setGlobalShortcut).mockRejectedValueOnce(
        new Error('该快捷键已被其他程序占用'),
      )
      const wrapper = await openStartup()
      await keyBox(wrapper).trigger('click')
      await pressKey(wrapper, { key: 'F9', code: 'F9', altKey: true })
      await flushPromises()
      expect(wrapper.find('[data-test=global-shortcut-error]').text()).toBe(
        '该快捷键已被其他程序占用',
      )
      expect(keyBox(wrapper).text()).toBe('Ctrl+Alt+T')
      wrapper.unmount()
    })

    it('关掉开关 → 提交关闭、键位框置灰（aria-disabled）点了不录；再打开失败则红字并还原复选框', async () => {
      const api = installFakeApi()
      const wrapper = await openStartup()
      const box = () =>
        wrapper.find('[data-test=global-shortcut-enabled]').element as HTMLInputElement
      await wrapper.find('[data-test=global-shortcut-enabled]').setValue(false)
      await flushPromises()
      expect(api.app.setGlobalShortcut).toHaveBeenCalledWith({
        enabled: false,
        accelerator: 'Ctrl+Alt+T',
      })
      expect(keyBox(wrapper).attributes('aria-disabled')).toBe('true')
      await keyBox(wrapper).trigger('click')
      expect(api.app.pauseGlobalShortcut).not.toHaveBeenCalled()
      expect(keyBox(wrapper).text()).toBe('Ctrl+Alt+T')

      vi.mocked(api.app.setGlobalShortcut).mockRejectedValueOnce(
        new Error('该快捷键已被其他程序占用'),
      )
      await wrapper.find('[data-test=global-shortcut-enabled]').setValue(true)
      await flushPromises()
      expect(box().checked).toBe(false)
      expect(wrapper.find('[data-test=global-shortcut-error]').text()).toBe(
        '该快捷键已被其他程序占用',
      )
      wrapper.unmount()
    })

    it('录制中关掉弹窗：恢复热键', async () => {
      const api = installFakeApi()
      const wrapper = await openStartup()
      await keyBox(wrapper).trigger('click')
      wrapper.unmount()
      expect(api.app.pauseGlobalShortcut).toHaveBeenLastCalledWith(false)
    })
  })

  it('「更新」段：检查更新 → 状态文案；有新版本出现「下载」；下载完成出现「立即安装并重启」', async () => {
    const api = installFakeApi()
    const update = useUpdateStore()
    const wrapper = mount(SettingsModal)
    await flushPromises()
    await wrapper.find('[data-test=settings-nav-update]').trigger('click')

    expect(wrapper.find('[data-test=update-status]').text()).toBe('') // idle 无文案
    await wrapper.find('[data-test=update-check]').trigger('click')
    expect(api.update.check).toHaveBeenCalled()

    update.status = { state: 'available', version: '0.3.0' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test=update-status]').text()).toBe('发现新版本 v0.3.0')
    await wrapper.find('[data-test=update-download]').trigger('click')
    expect(api.update.download).toHaveBeenCalled()

    update.status = { state: 'downloaded', version: '0.3.0' }
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test=update-install]').trigger('click')
    expect(api.update.install).toHaveBeenCalled()
  })

  it('「Agent」段：打开取一次两个目标的状态并显示端口与「即时生效」；切换开关调 setHooks(agent, enabled) 并按返回回填；reject → 该开关下红字 + 复选框还原，另一个开关不受影响', async () => {
    const api = installFakeApi({
      agent: {
        getHooksStatus: vi.fn(async () => ({
          claude: {
            installed: true,
            port: 51233,
            settingsPath: 'C:/Users/k/.claude/settings.json',
          },
          codex: {
            installed: false,
            port: 51233,
            settingsPath: 'C:/Users/k/.codex/hooks.json',
            error: 'Codex 配置文件不是合法 JSON',
          },
        })),
      },
    })
    const wrapper = mount(SettingsModal)
    await flushPromises()
    expect(wrapper.findAll('.nav-item').map((n) => n.text())).toContain('Agent')
    await wrapper.find('[data-test=settings-nav-agent]').trigger('click')
    await flushPromises()
    const box = (agent: string) =>
      wrapper.find(`[data-test=hooks-${agent}]`).element as HTMLInputElement

    expect(api.agent.getHooksStatus).toHaveBeenCalledTimes(1)
    expect(box('claude').checked).toBe(true)
    expect(box('codex').checked).toBe(false)
    expect(wrapper.find('[data-test=hooks-claude-label]').text()).toBe('安装 Claude Code hooks')
    expect(wrapper.find('[data-test=hooks-codex-label]').text()).toBe('安装 Codex hooks')
    expect(wrapper.find('[data-test=hooks-claude-status]').text()).toBe('已安装')
    expect(wrapper.find('[data-test=hooks-codex-status]').text()).toBe('未安装')
    expect(wrapper.find('[data-test=hooks-codex-error]').text()).toBe('Codex 配置文件不是合法 JSON')
    expect(wrapper.find('[data-test=hooks-claude-error]').exists()).toBe(false)
    expect(wrapper.find('[data-test=hooks-port]').text()).toBe('端口 51233')
    expect(wrapper.find('[data-test=hooks-instant]').text()).toContain('即时生效')
    expect(wrapper.find('[data-test=hooks-claude-hint]').text()).toContain(
      '~/.claude/settings.json',
    )
    expect(wrapper.find('[data-test=hooks-codex-hint]').text()).toContain('~/.codex/hooks.json')

    await wrapper.find('[data-test=hooks-codex]').setValue(true)
    await flushPromises()
    expect(api.agent.setHooks).toHaveBeenCalledWith('codex', true)
    expect(box('codex').checked).toBe(true)
    expect(wrapper.find('[data-test=hooks-codex-status]').text()).toBe('已安装')
    expect(wrapper.find('[data-test=hooks-codex-error]').exists()).toBe(false)

    vi.mocked(api.agent.setHooks).mockRejectedValueOnce(new Error('未找到 Claude Code 配置文件'))
    await wrapper.find('[data-test=hooks-claude]').setValue(false)
    await flushPromises()
    expect(box('claude').checked).toBe(true)
    expect(wrapper.find('[data-test=hooks-claude-error]').text()).toBe(
      '未找到 Claude Code 配置文件',
    )
    expect(box('codex').checked).toBe(true)
    expect(wrapper.find('[data-test=hooks-codex-error]').exists()).toBe(false)
  })

  it('「关于」显示版本与数据目录', async () => {
    installFakeApi({ app: { getVersion: async () => '0.1.0' } })
    const wrapper = mount(SettingsModal)
    await flushPromises()
    await wrapper.find('[data-test=settings-nav-about]').trigger('click')

    expect(wrapper.find('[data-test=about-version]').text()).toBe('TagTerm v0.1.0')
    expect(wrapper.find('[data-test=about-data-dir]').text()).toBe(
      'C:/Users/test/AppData/Roaming/TagTerm',
    )
  })

  it('「关于」的「打开日志目录」调 app.openLogsDir（不传路径，由主进程定）；500 ms 内连点只打开一次；打不开时弹窗内红字', async () => {
    vi.useFakeTimers()
    try {
      const api = installFakeApi()
      const wrapper = mount(SettingsModal)
      await flushPromises()
      await wrapper.find('[data-test=settings-nav-about]').trigger('click')

      const button = wrapper.find('[data-test=about-open-logs]')
      expect(button.text()).toBe('打开日志目录')
      await button.trigger('click')
      await button.trigger('click') // 双击：资源管理器只该开一个窗口
      await flushPromises()
      expect(api.app.openLogsDir).toHaveBeenCalledTimes(1)
      expect(api.app.openLogsDir).toHaveBeenCalledWith()
      expect(wrapper.find('[data-test=settings-error]').exists()).toBe(false)

      await vi.advanceTimersByTimeAsync(500)
      vi.mocked(api.app.openLogsDir).mockRejectedValueOnce(
        new Error('打不开日志目录：Access is denied'),
      )
      await button.trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test=settings-error]').text()).toBe(
        '打不开日志目录：Access is denied',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  describe('「导入导出」段（即时生效）', () => {
    // 字号偏好存 localStorage：前一条用例设的字号别漏到下一条
    beforeEach(() => localStorage.clear())

    const IMPORT_RESULT = {
      path: 'D:/exports/tagterm-config-20260924.json',
      backupPath:
        'C:/Users/test/AppData/Roaming/TagTerm/backups/tagterm-config-20260924-080000.json',
      items: [
        { key: 'tags' as const, outcome: 'applied' as const, message: '新建 1 个、更新 2 个' },
        { key: 'launchCommands' as const, outcome: 'applied' as const },
        { key: 'appearance' as const, outcome: 'unchanged' as const },
        {
          key: 'globalShortcut' as const,
          outcome: 'failed' as const,
          message: '该快捷键已被其他程序占用',
        },
        { key: 'autoLaunch' as const, outcome: 'absent' as const },
        { key: 'hooks' as const, outcome: 'applied' as const },
        { key: 'terminalFontSize' as const, outcome: 'applied' as const },
      ],
      terminalFontSize: 15,
    }

    // 重复打桩复用同一个替身（先清空调用记录），与 SessionGroups / ManageTagsModal 的测试同一写法
    function stubConfirm(result: boolean) {
      const confirm = useConfirmStore()
      const spy = vi.isMockFunction(confirm.ask) ? vi.mocked(confirm.ask) : vi.spyOn(confirm, 'ask')
      spy.mockReset()
      spy.mockResolvedValue(result)
      return spy
    }

    it('说明带什么 / 不带什么；「导出配置…」只交出当前终端字号，成功显示写到的路径，取消什么都不显示，失败红字', async () => {
      const api = installFakeApi({
        app: { exportConfig: vi.fn(async () => ({ path: 'D:/exports/a.json' })) },
      })
      const { core } = installFakeWorkspace()
      core.setFontSize(18)
      const wrapper = mount(SettingsModal)
      await flushPromises()
      await wrapper.find('[data-test=settings-nav-config]').trigger('click')

      expect(wrapper.find('[data-test=config-immediate]').text()).toContain('即时生效')
      expect(wrapper.find('[data-test=config-scope]').text()).toContain(
        '不包含：会话、会话的标签、背景图片',
      )
      await wrapper.find('[data-test=config-export]').trigger('click')
      await flushPromises()
      expect(api.app.exportConfig).toHaveBeenCalledWith({ terminalFontSize: 18 })
      expect(wrapper.find('[data-test=config-exported]').text()).toBe('已导出到 D:/exports/a.json')

      vi.mocked(api.app.exportConfig).mockResolvedValueOnce(null)
      await wrapper.find('[data-test=config-export]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test=config-exported]').text()).toBe('已导出到 D:/exports/a.json')

      vi.mocked(api.app.exportConfig).mockRejectedValueOnce(
        new Error('EPERM: operation not permitted'),
      )
      await wrapper.find('[data-test=config-export]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test=settings-error]').text()).toBe(
        'EPERM: operation not permitted',
      )
    })

    it('「导入配置…」先经应用内确认弹窗（取消不调）；确认后逐项显示结果与备份路径，套用字号、重取启动 / Agent 两段状态、外观草稿重置为新保存的值', async () => {
      const api = installFakeApi({
        app: {
          importConfig: vi.fn(async () => {
            // 主进程应用完会广播 settings:changed：这里直接把 store 的已保存值换掉
            useSettingsStore().settings = makeSettings({
              background: { ...DEFAULT_BACKGROUND, blurPx: 9 },
            })
            return IMPORT_RESULT
          }),
          getGlobalShortcut: vi
            .fn()
            .mockResolvedValueOnce({ enabled: true, accelerator: 'Ctrl+Alt+T', registered: true })
            .mockResolvedValueOnce({ enabled: true, accelerator: 'Ctrl+Alt+Y', registered: true }),
        },
      })
      const { workspace } = installFakeWorkspace()
      const wrapper = mount(SettingsModal)
      await flushPromises()
      await wrapper.find('[data-test=settings-nav-config]').trigger('click')

      const confirm = stubConfirm(false)
      await wrapper.find('[data-test=config-import]').trigger('click')
      await flushPromises()
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(confirm.mock.calls[0]![0]).toContain('标签按名合并')
      expect(confirm.mock.calls[0]![0]).toContain('导入前会先自动备份')
      expect(api.app.importConfig).not.toHaveBeenCalled()

      stubConfirm(true)
      await wrapper.find('[data-test=config-import]').trigger('click')
      await flushPromises()
      expect(api.app.importConfig).toHaveBeenCalledWith({ terminalFontSize: 14 })
      expect(wrapper.find('[data-test=config-imported]').text()).toBe(
        '已导入 D:/exports/tagterm-config-20260924.json',
      )
      expect(wrapper.findAll('[data-test=config-import-result] li').map((li) => li.text())).toEqual(
        [
          '标签：已应用（新建 1 个、更新 2 个）',
          '唤起命令：已应用',
          '外观参数：与本机相同，未改',
          '全局快捷键：失败（该快捷键已被其他程序占用）',
          '开机自启：文件里没有，未改',
          'Agent hooks 开关：已应用',
          '终端字号：已应用',
        ],
      )
      expect(wrapper.find('[data-test=config-item-globalShortcut]').classes()).toContain('failed')
      expect(wrapper.find('[data-test=config-backup]').text()).toBe(
        '导入前的配置已备份到 C:/Users/test/AppData/Roaming/TagTerm/backups/tagterm-config-20260924-080000.json',
      )
      expect(workspace.fontSize).toBe(15)
      expect(api.app.getAutoLaunch).toHaveBeenCalledTimes(2)
      expect(api.agent.getHooksStatus).toHaveBeenCalledTimes(2)
      await wrapper.find('[data-test=settings-nav-startup]').trigger('click')
      expect(wrapper.find('[data-test=global-shortcut-key]').text()).toBe('Ctrl+Alt+Y')

      // 外观草稿已重置：此时「保存设置」提交的是导入后的值，不会把它冲掉
      await wrapper.find('[data-test=settings-save]').trigger('click')
      await flushPromises()
      expect(api.settings.update).toHaveBeenCalledWith({
        background: { ...DEFAULT_BACKGROUND, blurPx: 9 },
      })
    })

    it('导入进行中两个按钮置灰，失败走弹窗底部红字', async () => {
      let finish: (value: null) => void = () => {}
      const api = installFakeApi({
        app: {
          importConfig: vi.fn(() => new Promise<null>((resolve) => (finish = resolve))),
        },
      })
      installFakeWorkspace()
      const wrapper = mount(SettingsModal)
      await flushPromises()
      await wrapper.find('[data-test=settings-nav-config]').trigger('click')
      stubConfirm(true)

      await wrapper.find('[data-test=config-import]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test=config-import]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-test=config-export]').attributes('disabled')).toBeDefined()
      finish(null)
      await flushPromises()
      expect(wrapper.find('[data-test=config-import]').attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-test=config-import-result]').exists()).toBe(false)

      vi.mocked(api.app.importConfig).mockRejectedValueOnce(new Error('不是 TagTerm 配置文件'))
      await wrapper.find('[data-test=config-import]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test=settings-error]').text()).toBe('不是 TagTerm 配置文件')
    })
  })
})
