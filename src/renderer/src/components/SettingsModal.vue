<script setup lang="ts">
// 「设置」弹窗：左侧四段导航（外观 / 启动 / 更新 / 关于）。
// 外观段是草稿语义（决策 2）：改动只进本地草稿，经 settings.previewBackground 整窗实时生效但不落盘；
// 「保存设置」才提交，「取消」/ Esc / 点遮罩丢弃草稿并还原。启动 / 更新 / 关于三段即时生效。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AutoLaunchStatus } from '@shared/ipc'
import type { AppBackground, BackgroundFit } from '@shared/models'
import { MAX_BLUR_PX, MIN_PANEL_OPACITY } from '@shared/models'
import { useSettingsStore } from '../stores/settings'
import { useUpdateStore } from '../stores/update'
import { describeUpdateStatus } from '../composables/updateStatus'

type SectionKey = 'appearance' | 'startup' | 'update' | 'about'

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'appearance', label: '外观' },
  { key: 'startup', label: '启动' },
  { key: 'update', label: '更新' },
  { key: 'about', label: '关于' },
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
/** 外观段草稿：打开时取已保存值，改动只进这里，保存才落盘 */
const draft = ref<AppBackground>({ ...settings.background })
const isLivePreview = ref(true)
/** 关掉实时预览时弹窗内缩略图要单独读图（整窗仍用已保存值） */
const draftImage = ref<string | null>(null)

const hasImage = computed(() => draft.value.imagePath !== null)
const fileName = computed(() => draft.value.imagePath?.split(/[\\/]/).pop() ?? '未设置背景')
const thumbnail = computed(() =>
  isLivePreview.value ? settings.backgroundImage : draftImage.value,
)
const isImageMissing = computed(() => hasImage.value && thumbnail.value === null)
const imagePercent = computed(() => Math.round(draft.value.imageOpacity * 100))
const panelPercent = computed(() => Math.round(draft.value.panelOpacity * 100))
const minPanelPercent = Math.round(MIN_PANEL_OPACITY * 100)
/** 显示方式的说明随选项变化（原型图只画了「完整显示」那一条） */
const fitHint = computed(() => FITS.find((f) => f.value === draft.value.fit)?.hint ?? '')

const updateText = computed(() => describeUpdateStatus(update.status))
/** 检查 / 下载进行中不允许再点 */
const isUpdateBusy = computed(() => ['checking', 'downloading'].includes(update.status.state))

async function runUpdateAction(action: () => Promise<void>): Promise<void> {
  error.value = ''
  try {
    await action()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  try {
    ;[version.value, dataDir.value, autoLaunch.value] = await Promise.all([
      window.tagterm.app.getVersion(),
      window.tagterm.app.getDataDir(),
      window.tagterm.app.getAutoLaunch(),
    ])
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// 草稿或预览开关变化 → 整窗预览跟着变（关掉预览就还原为已保存值）
watch(
  [draft, isLivePreview],
  () => {
    void applyPreview()
  },
  { deep: true },
)

async function applyPreview(): Promise<void> {
  error.value = ''
  try {
    await settings.previewBackground(isLivePreview.value ? { ...draft.value } : null)
    if (!isLivePreview.value) await loadDraftImage()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

/** 预览关闭时缩略图自己读图（读取失败按「文件不存在」处理，红字由调用处显示） */
async function loadDraftImage(): Promise<void> {
  const path = draft.value.imagePath
  draftImage.value = path ? await window.tagterm.settings.readBackgroundImage(path) : null
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
            <label class="check" data-test="auto-launch-label">
              <input
                type="checkbox"
                :checked="autoLaunch.enabled"
                data-test="auto-launch"
                @change="onAutoLaunchChange"
              />
              开机时自动启动 TagTerm
            </label>
            <p class="hint" data-test="auto-launch-instant">即时生效，不受下方「保存设置」影响</p>
            <p v-if="autoLaunch.blockedBySystem" class="hint" data-test="auto-launch-blocked">
              已在系统「启动应用」中被禁用
            </p>
          </section>

          <section v-else-if="section === 'update'">
            <h4>更新</h4>
            <div class="row">
              <button
                class="btn sm"
                type="button"
                :disabled="isUpdateBusy"
                data-test="update-check"
                @click="runUpdateAction(update.check)"
              >
                检查更新
              </button>
              <button
                v-if="update.status.state === 'available'"
                class="btn sm primary"
                type="button"
                data-test="update-download"
                @click="runUpdateAction(update.download)"
              >
                下载
              </button>
              <button
                v-if="update.status.state === 'downloaded'"
                class="btn sm primary"
                type="button"
                data-test="update-install"
                @click="runUpdateAction(update.install)"
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
          </section>

          <p v-if="error" class="error" data-test="settings-error">{{ error }}</p>
        </div>
      </div>

      <footer>
        <label class="check" data-test="live-preview-label">
          <input type="checkbox" v-model="isLivePreview" data-test="live-preview" />
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
