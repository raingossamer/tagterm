<script setup lang="ts">
// 「设置」弹窗：左侧五段导航（外观 / 启动 / Agent / 更新 / 关于）。
// 外观段是草稿语义（决策 2）：改动只进本地草稿，经 settings.previewBackground 整窗实时生效但不落盘；
// 「保存设置」才提交，「取消」/ Esc / 点遮罩丢弃草稿并还原。启动 / Agent / 更新 / 关于四段即时生效。
// Agent 段：两个开关分别安装 / 移除 Claude Code 与 Codex 的 hooks（改用户配置文件前先备份），各自独立的状态与错误红字
// 启动段另有全局快捷键（唤出 / 隐藏窗口）：开关 + 键位框，点键位框后按下新组合即改（录制期间暂停当前热键），Esc / 失焦取消
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AutoLaunchStatus, GlobalShortcutStatus, HookAgent, HooksStatusMap } from '@shared/ipc'
import type { AppBackground, BackgroundFit, GlobalShortcutConfig } from '@shared/models'
import { MAX_BLUR_PX, MIN_PANEL_OPACITY } from '@shared/models'
import { DEFAULT_GLOBAL_SHORTCUT } from '@shared/accelerator'
import { useSettingsStore } from '../stores/settings'
import { useUpdateStore } from '../stores/update'
import { describeUpdateStatus } from '../composables/updateStatus'
import { createCooldown } from '../composables/cooldown'
import { captureAccelerator } from '../composables/shortcutCapture'

const SHORTCUT_OCCUPIED = '该快捷键已被其他程序占用，换一个组合'
const SHORTCUT_RULE = '需要包含 Ctrl 或 Alt，再加字母、数字或 F1–F12'
const SHORTCUT_HINT =
  '窗口在前台时按下藏到托盘，否则唤出并把焦点交给当前终端。点击键位框后按下新组合，Esc 取消'

type SectionKey = 'appearance' | 'startup' | 'agent' | 'update' | 'about'

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'appearance', label: '外观' },
  { key: 'startup', label: '启动' },
  { key: 'agent', label: 'Agent' },
  { key: 'update', label: '更新' },
  { key: 'about', label: '关于' },
]

const HOOK_AGENTS: Array<{ key: HookAgent; label: string; hint: string }> = [
  {
    key: 'claude',
    label: '安装 Claude Code hooks',
    hint: '打开后会备份并修改 ~/.claude/settings.json，只追加 TagTerm 自己的条目；关闭即移除',
  },
  {
    key: 'codex',
    label: '安装 Codex hooks',
    hint: '打开后会写入 ~/.codex/hooks.json（不存在则新建，存在则先备份），不改 config.toml；关闭即移除',
  },
]

const FITS: Array<{ value: BackgroundFit; label: string; hint: string }> = [
  { value: 'contain', label: '完整显示', hint: '保留整张图片，空白区域使用主题底色' },
  { value: 'cover', label: '填充窗口', hint: '等比放大铺满窗口，超出的部分裁掉' },
  { value: 'tile', label: '平铺', hint: '按原始尺寸重复铺满窗口' },
]

const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()
const update = useUpdateStore()

const section = ref<SectionKey>('appearance')
const version = ref('')
const dataDir = ref('')
const error = ref('')
/** 开机自启：打开弹窗时向主进程取一次，改动后以返回的实际状态回填（不进 store、不落盘） */
const autoLaunch = ref<AutoLaunchStatus>({ enabled: false, blockedBySystem: false })
/** 全局快捷键：打开弹窗时取一次，改动后以返回的实际状态回填；配置落 settings.json 由主进程负责 */
const shortcut = ref<GlobalShortcutStatus>({
  enabled: true,
  accelerator: DEFAULT_GLOBAL_SHORTCUT,
  registered: true,
})
const isCapturing = ref(false)
const shortcutError = ref('')
/** 键位框下的红字：这次操作的错误优先，否则启动时没注册上（被别的程序占着）也要说 */
const shortcutProblem = computed(
  () =>
    shortcutError.value ||
    (shortcut.value.enabled && !shortcut.value.registered ? SHORTCUT_OCCUPIED : ''),
)
/** hooks 安装状态：打开弹窗时取一次，切换开关后以返回的实际状态回填；两个目标各自的错误红字 */
const hooks = ref<HooksStatusMap | null>(null)
const hooksError = ref<Record<HookAgent, string>>({ claude: '', codex: '' })
/** 外观段草稿：打开时取已保存值，改动只进这里，保存才落盘 */
const draft = ref<AppBackground>({ ...settings.background })
const isLivePreview = ref(true)
/** 关掉实时预览时弹窗内缩略图要单独读图（整窗仍用已保存值）；读不出来的原因另记 */
const draftImage = ref<string | null>(null)
const draftImageError = ref('')

const hasImage = computed(() => draft.value.imagePath !== null)
const fileName = computed(() => draft.value.imagePath?.split(/[\\/]/).pop() ?? '未设置背景')
const thumbnail = computed(() =>
  isLivePreview.value ? settings.backgroundImage : draftImage.value,
)
/** 缩略图那张图读不出来的原因（太大、格式不支持）：实时预览看整窗生效的图，关掉预览看草稿自己读的图 */
const imageError = computed(() => {
  if (!hasImage.value) return ''
  return isLivePreview.value ? settings.imageError : draftImageError.value
})
const isImageMissing = computed(
  () => hasImage.value && thumbnail.value === null && !imageError.value,
)
const imagePercent = computed(() => Math.round(draft.value.imageOpacity * 100))
const panelPercent = computed(() => Math.round(draft.value.panelOpacity * 100))
const minPanelPercent = Math.round(MIN_PANEL_OPACITY * 100)
/** 显示方式的说明随选项变化（原型图只画了「完整显示」那一条） */
const fitHint = computed(() => FITS.find((f) => f.value === draft.value.fit)?.hint ?? '')

const updateText = computed(() => describeUpdateStatus(update.status))
/** 检查 / 下载进行中不允许再点 */
const isUpdateBusy = computed(() => ['checking', 'downloading'].includes(update.status.state))

/** 即时生效的按钮（检查更新、下载、安装、打开日志目录）：先清红字，失败把中文 message 显示在弹窗底部 */
async function runAction(action: () => Promise<void>): Promise<void> {
  error.value = ''
  try {
    await action()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// 「关于」→「打开日志目录」：路径由主进程定（渲染进程不传路径）；会弹资源管理器，500 ms 冷却防双击开两个窗口；打不开红字
const canOpenLogs = createCooldown(500)
function openLogsDir(): void {
  if (!canOpenLogs()) return
  void runAction(() => window.tagterm.app.openLogsDir())
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  try {
    ;[version.value, dataDir.value, autoLaunch.value, hooks.value, shortcut.value] =
      await Promise.all([
        window.tagterm.app.getVersion(),
        window.tagterm.app.getDataDir(),
        window.tagterm.app.getAutoLaunch(),
        window.tagterm.agent.getHooksStatus(),
        window.tagterm.app.getGlobalShortcut(),
      ])
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

/** 勾选即安装 / 移除该目标的 hooks；失败红字在该开关下并把复选框还原为实际状态，另一个开关不受影响 */
async function onHooksChange(agent: HookAgent, e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  hooksError.value = { ...hooksError.value, [agent]: '' }
  try {
    const status = await window.tagterm.agent.setHooks(agent, input.checked)
    if (hooks.value) hooks.value = { ...hooks.value, [agent]: status }
  } catch (err) {
    hooksError.value = {
      ...hooksError.value,
      [agent]: err instanceof Error ? err.message : String(err),
    }
    input.checked = hooks.value?.[agent].installed ?? false
  }
}
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  // 录制中关掉弹窗：把暂停的热键恢复
  if (isCapturing.value) void window.tagterm.app.pauseGlobalShortcut(false)
})

// 草稿或预览开关变化 → 整窗预览跟着变（关掉预览就还原为已保存值）
watch(
  [draft, isLivePreview],
  () => {
    void applyPreview()
  },
  { deep: true },
)

// 读不出来的图（太大、格式不支持）不在这里报错：整窗回退纯色，原因写在缩略图下（imageError）
async function applyPreview(): Promise<void> {
  error.value = ''
  await settings.previewBackground(isLivePreview.value ? { ...draft.value } : null)
  if (!isLivePreview.value) await loadDraftImage()
}

/** 预览关闭时缩略图自己读图；读不出来缩略图为空并记下原因 */
async function loadDraftImage(): Promise<void> {
  const path = draft.value.imagePath
  try {
    draftImage.value = path ? await window.tagterm.settings.readBackgroundImage(path) : null
    draftImageError.value = ''
  } catch (err) {
    draftImage.value = null
    draftImageError.value = err instanceof Error ? err.message : String(err)
  }
}

async function pickImage(): Promise<void> {
  const picked = await window.tagterm.app.pickImage()
  if (picked) draft.value = { ...draft.value, imagePath: picked }
}

function clearImage(): void {
  draft.value = { ...draft.value, imagePath: null }
}

function onFitChange(e: Event): void {
  draft.value = { ...draft.value, fit: (e.target as HTMLSelectElement).value as BackgroundFit }
}
function onImageOpacity(e: Event): void {
  draft.value = { ...draft.value, imageOpacity: Number((e.target as HTMLInputElement).value) / 100 }
}
function onPanelOpacity(e: Event): void {
  draft.value = { ...draft.value, panelOpacity: Number((e.target as HTMLInputElement).value) / 100 }
}
function onBlur(e: Event): void {
  draft.value = { ...draft.value, blurPx: Number((e.target as HTMLInputElement).value) }
}

/** 勾选即写登录项；失败（如开发模式）红字提示并把复选框还原为实际状态 */
async function onAutoLaunchChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  error.value = ''
  try {
    autoLaunch.value = await window.tagterm.app.setAutoLaunch(input.checked)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    input.checked = autoLaunch.value.enabled
  }
}

/** 提交全局快捷键配置（主进程先注册、成功才落盘）；被占用等失败红字，返回是否成功 */
async function submitShortcut(config: GlobalShortcutConfig): Promise<boolean> {
  shortcutError.value = ''
  try {
    shortcut.value = await window.tagterm.app.setGlobalShortcut(config)
    return true
  } catch (err) {
    shortcutError.value = err instanceof Error ? err.message : String(err)
    return false
  }
}

async function onShortcutEnabledChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const isOk = await submitShortcut({
    enabled: input.checked,
    accelerator: shortcut.value.accelerator,
  })
  if (!isOk) input.checked = shortcut.value.enabled
}

/** 点键位框开始录制：先暂停当前热键，免得按到旧键把窗口藏掉；关着开关时框是置灰的，点了不录 */
function startCapture(): void {
  if (!shortcut.value.enabled || isCapturing.value) return
  shortcutError.value = ''
  isCapturing.value = true
  void window.tagterm.app.pauseGlobalShortcut(true)
}

async function stopCapture(): Promise<void> {
  if (!isCapturing.value) return
  isCapturing.value = false
  await window.tagterm.app.pauseGlobalShortcut(false)
}

/** 录制中的按键全部截下（Esc 也不冒泡到弹窗的关闭监听）：只按修饰键继续等、不合法提示规则、合法即提交 */
async function onShortcutKeydown(e: KeyboardEvent): Promise<void> {
  if (!isCapturing.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    shortcutError.value = ''
    await stopCapture()
    return
  }
  const result = captureAccelerator(e)
  if (result.kind === 'pending') return
  if (result.kind === 'invalid') {
    shortcutError.value = SHORTCUT_RULE
    return
  }
  await stopCapture()
  await submitShortcut({ enabled: true, accelerator: result.value })
}

function onShortcutBlur(): void {
  if (!isCapturing.value) return
  shortcutError.value = ''
  void stopCapture()
}

async function save(): Promise<void> {
  error.value = ''
  try {
    await settings.saveBackground({ ...draft.value })
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

/** 取消 / Esc / 点遮罩：丢弃草稿，整窗还原为已保存值 */
async function cancel(): Promise<void> {
  await settings.previewBackground(null)
  emit('close')
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) void cancel()
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') void cancel()
}
</script>

<template>
  <div class="backdrop show" data-test="settings-modal" @mousedown="onBackdropMousedown">
    <div class="modal">
      <header>
        <h3>设置</h3>
        <button class="x" type="button" title="关闭" data-test="settings-close" @click="cancel">
          ×
        </button>
      </header>

      <div class="body">
        <nav class="nav">
          <button
            v-for="s in SECTIONS"
            :key="s.key"
            class="nav-item"
            :class="{ on: section === s.key }"
            type="button"
            :data-test="`settings-nav-${s.key}`"
            @click="section = s.key"
          >
            {{ s.label }}
          </button>
        </nav>

        <div class="pane">
          <section v-if="section === 'appearance'" data-test="appearance-section">
            <h4>全局背景</h4>
            <p class="hint">应用于侧边栏、标签栏和终端等整个窗口</p>
            <div class="bg-row">
              <div class="thumb" data-test="bg-thumb">
                <img v-if="thumbnail" :src="thumbnail" alt="" />
                <span v-else class="none">无背景</span>
              </div>
              <div class="bg-actions">
                <button class="btn primary" type="button" data-test="bg-pick" @click="pickImage">
                  更换图片
                </button>
                <button
                  class="btn"
                  type="button"
                  :disabled="!hasImage"
                  data-test="bg-clear"
                  @click="clearImage"
                >
                  移除背景
                </button>
                <p class="hint">支持 PNG、JPG、WebP</p>
              </div>
            </div>
            <p class="name mono" data-test="bg-name">{{ fileName }}</p>
            <p v-if="isImageMissing" class="warn" data-test="bg-missing">
              图片文件不存在，已回退为纯色
            </p>
            <p v-if="imageError" class="warn" data-test="bg-error" v-text="imageError"></p>

            <div class="field-row">
              <div class="label">
                <b>显示方式</b>
                <span class="hint" data-test="bg-fit-hint">{{ fitHint }}</span>
              </div>
              <select
                class="select"
                :value="draft.fit"
                :disabled="!hasImage"
                data-test="bg-fit"
                @change="onFitChange"
              >
                <option v-for="f in FITS" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </div>

            <div class="field-row">
              <div class="label">
                <b>背景不透明度</b>
                <span class="hint">数值越低，背景图片越淡</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                :value="imagePercent"
                :disabled="!hasImage"
                data-test="bg-image-opacity"
                @input="onImageOpacity"
              />
              <span class="val" data-test="bg-image-opacity-value">{{ imagePercent }}%</span>
            </div>

            <div class="field-row">
              <div class="label">
                <b>面板不透明度</b>
                <span class="hint">调高面板遮罩，文字保持清晰</span>
              </div>
              <input
                type="range"
                :min="minPanelPercent"
                max="100"
                :value="panelPercent"
                :disabled="!hasImage"
                data-test="bg-panel-opacity"
                @input="onPanelOpacity"
              />
              <span class="val" data-test="bg-panel-opacity-value">{{ panelPercent }}%</span>
            </div>

            <div class="field-row">
              <div class="label">
                <b>背景模糊</b>
                <span class="hint">让背景更柔和</span>
              </div>
              <input
                type="range"
                min="0"
                :max="MAX_BLUR_PX"
                :value="draft.blurPx"
                :disabled="!hasImage"
                data-test="bg-blur"
                @input="onBlur"
              />
              <span class="val" data-test="bg-blur-value">{{ draft.blurPx }} px</span>
            </div>

            <p class="note">背景在整个窗口连续显示，文字与图标不受透明度影响。</p>
          </section>

          <section v-else-if="section === 'startup'" data-test="auto-launch-section">
            <h4>启动</h4>
            <p class="hint" data-test="auto-launch-instant">即时生效，不受下方「保存设置」影响</p>
            <label class="check" data-test="auto-launch-label">
              <input
                type="checkbox"
                :checked="autoLaunch.enabled"
                data-test="auto-launch"
                @change="onAutoLaunchChange"
              />
              开机时自动启动 TagTerm
            </label>
            <p v-if="autoLaunch.blockedBySystem" class="hint" data-test="auto-launch-blocked">
              已在系统「启动应用」中被禁用
            </p>

            <div class="shortcut" data-test="global-shortcut-section">
              <label class="check" data-test="global-shortcut-label">
                <input
                  type="checkbox"
                  :checked="shortcut.enabled"
                  data-test="global-shortcut-enabled"
                  @change="onShortcutEnabledChange"
                />
                <span v-text="'全局快捷键唤出 / 隐藏窗口'"></span>
              </label>
              <div class="row">
                <button
                  class="key-box mono"
                  :class="{ capturing: isCapturing }"
                  type="button"
                  data-test="global-shortcut-key"
                  :aria-disabled="shortcut.enabled ? undefined : 'true'"
                  :title="shortcut.enabled ? '点击后按下新的组合键' : '先打开左边的开关'"
                  @click="startCapture"
                  @keydown="onShortcutKeydown"
                  @blur="onShortcutBlur"
                  v-text="isCapturing ? '按下新的组合键…' : shortcut.accelerator"
                ></button>
              </div>
              <p class="hint" data-test="global-shortcut-hint" v-text="SHORTCUT_HINT"></p>
              <p
                v-if="shortcutProblem"
                class="error"
                data-test="global-shortcut-error"
                v-text="shortcutProblem"
              ></p>
            </div>
          </section>

          <section v-else-if="section === 'agent'" data-test="agent-section">
            <h4>Agent</h4>
            <p class="hint" data-test="hooks-instant">即时生效，不受下方「保存设置」影响</p>
            <div v-for="a in HOOK_AGENTS" :key="a.key" class="hooks-row">
              <div class="row">
                <label class="check" :data-test="`hooks-${a.key}-label`">
                  <input
                    type="checkbox"
                    :checked="hooks?.[a.key].installed ?? false"
                    :data-test="`hooks-${a.key}`"
                    @change="onHooksChange(a.key, $event)"
                  />
                  <span v-text="a.label"></span>
                </label>
                <span
                  class="hooks-status"
                  :data-test="`hooks-${a.key}-status`"
                  v-text="hooks?.[a.key].installed ? '已安装' : '未安装'"
                ></span>
              </div>
              <p class="hint" :data-test="`hooks-${a.key}-hint`" v-text="a.hint"></p>
              <p
                v-if="hooksError[a.key] || hooks?.[a.key].error"
                class="error"
                :data-test="`hooks-${a.key}-error`"
                v-text="hooksError[a.key] || hooks?.[a.key].error"
              ></p>
            </div>
            <p class="hint mono" data-test="hooks-port">端口 {{ hooks?.claude.port ?? '…' }}</p>
          </section>

          <section v-else-if="section === 'update'">
            <h4>更新</h4>
            <div class="row">
              <button
                class="btn sm"
                type="button"
                :disabled="isUpdateBusy"
                data-test="update-check"
                @click="runAction(update.check)"
              >
                检查更新
              </button>
              <button
                v-if="update.status.state === 'available'"
                class="btn sm primary"
                type="button"
                data-test="update-download"
                @click="runAction(update.download)"
              >
                下载
              </button>
              <button
                v-if="update.status.state === 'downloaded'"
                class="btn sm primary"
                type="button"
                data-test="update-install"
                @click="runAction(update.install)"
              >
                立即安装并重启
              </button>
            </div>
            <p class="hint" data-test="update-status">{{ updateText }}</p>
          </section>

          <section v-else>
            <h4>关于</h4>
            <p data-test="about-version">TagTerm v{{ version }}</p>
            <p class="hint">数据目录</p>
            <p class="name mono" data-test="about-data-dir">{{ dataDir }}</p>
            <div class="row">
              <button
                class="btn sm"
                type="button"
                data-test="about-open-logs"
                @click="openLogsDir"
                v-text="'打开日志目录'"
              ></button>
            </div>
          </section>

          <p v-if="error" class="error" data-test="settings-error">{{ error }}</p>
        </div>
      </div>

      <footer>
        <label class="check" data-test="live-preview-label">
          <input v-model="isLivePreview" type="checkbox" data-test="live-preview" />
          实时预览
        </label>
        <span class="spacer"></span>
        <button class="btn" type="button" data-test="settings-cancel" @click="cancel">取消</button>
        <button class="btn primary" type="button" data-test="settings-save" @click="save">
          保存设置
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  width: 680px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}
header {
  display: flex;
  align-items: center;
  padding: 14px 18px 10px;
}
header h3 {
  margin: 0;
  font-size: 16px;
  flex: 1;
}
.x {
  font-size: 18px;
  line-height: 1;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 6px;
}
.x:hover {
  background: #f0f2f5;
}
.body {
  display: flex;
  gap: 14px;
  padding: 0 18px;
  min-height: 0;
  flex: 1;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 116px;
  flex: none;
}
.nav-item {
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text);
}
.nav-item:hover {
  background: #f0f2f5;
}
.nav-item.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding-bottom: 8px;
}
section h4 {
  margin: 0 0 2px;
  font-size: 14px;
}
.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
}
.bg-row {
  display: flex;
  gap: 12px;
  margin: 10px 0 6px;
}
.thumb {
  width: 190px;
  height: 110px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb .none {
  font-size: 12px;
  color: var(--muted);
}
.bg-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.name {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--mono);
}
.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}
.field-row .label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.field-row .label b {
  font-size: 13px;
  font-weight: 500;
}
.field-row .label .hint {
  margin: 0;
}
.field-row input[type='range'] {
  width: 150px;
  flex: none;
}
.select {
  font: inherit;
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  min-width: 130px;
}
.val {
  font-size: 12.5px;
  min-width: 44px;
  text-align: right;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 6px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.note {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--muted);
  background: var(--accent-soft);
  border-radius: 6px;
  padding: 8px 10px;
}
.warn {
  margin: 0 0 8px;
  font-size: 12px;
  color: #b45309;
}
.error {
  margin: 10px 0 0;
  font-size: 12px;
  color: #b42318;
}
.shortcut {
  margin-top: 18px;
}
.key-box {
  min-width: 140px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  text-align: left;
}
.key-box.capturing {
  border-color: var(--accent);
  color: var(--accent);
}
.key-box[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
.hooks-row {
  padding: 8px 0;
  border-top: 1px solid var(--line);
}
.hooks-row .row {
  margin: 0 0 4px;
}
.hooks-status {
  font-size: 12px;
  color: var(--muted);
}
footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px 14px;
  border-top: 1px solid var(--line);
}
.spacer {
  flex: 1;
}
</style>
