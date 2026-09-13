<script setup lang="ts">
// 「设置」弹窗（主窗口内 modal）：终端背景（选图 / 清除 / 遮罩滑块即时预览）、启动（开机自启开关，真相在系统登录项）、
// 更新（检查 / 下载 / 安装）、关于
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { AutoLaunchStatus } from '@shared/ipc'
import { useSettingsStore } from '../stores/settings'
import { useUpdateStore } from '../stores/update'
import { describeUpdateStatus } from '../composables/updateStatus'

const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()
const update = useUpdateStore()

const version = ref('')
const dataDir = ref('')
const error = ref('')
/** 开机自启：打开弹窗时向主进程取一次，改动后以返回的实际状态回填（不进 store、不落盘） */
const autoLaunch = ref<AutoLaunchStatus>({ enabled: false, blockedBySystem: false })

const imagePath = computed(() => settings.settings.terminalBackground.imagePath)
const dimPercent = computed(() => Math.round(settings.terminalBackground.dimOpacity * 100))
const isImageMissing = computed(() => !!imagePath.value && settings.backgroundImage === null)

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

async function save(path: string | null, dimOpacity: number): Promise<void> {
  error.value = ''
  try {
    await settings.saveTerminalBackground({ imagePath: path, dimOpacity })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function pickImage(): Promise<void> {
  const picked = await window.tagterm.app.pickImage()
  if (picked) await save(picked, settings.terminalBackground.dimOpacity)
}

function clearImage(): Promise<void> {
  return save(null, settings.terminalBackground.dimOpacity)
}

/** 拖动中只预览，松手（change）才落盘 */
function onDimInput(e: Event): void {
  settings.previewDim(Number((e.target as HTMLInputElement).value) / 100)
}
function onDimChange(e: Event): Promise<void> {
  return save(imagePath.value, Number((e.target as HTMLInputElement).value) / 100)
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit('close')
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="backdrop show" data-test="settings-modal" @mousedown="onBackdropMousedown">
    <div class="modal">
      <h3>设置</h3>

      <section>
        <h4>终端背景</h4>
        <div class="row">
          <span class="path mono" data-test="bg-path">{{ imagePath ?? '未设置（纯色）' }}</span>
          <button class="btn sm" type="button" data-test="bg-pick" @click="pickImage">
            选择图片…
          </button>
          <button
            class="btn sm"
            type="button"
            :disabled="!imagePath"
            data-test="bg-clear"
            @click="clearImage"
          >
            清除
          </button>
        </div>
        <p v-if="isImageMissing" class="warn" data-test="bg-missing">
          图片文件不存在，已回退为纯色
        </p>
        <div class="row">
          <label for="bgDim">遮罩</label>
          <input
            id="bgDim"
            type="range"
            min="0"
            max="100"
            :value="dimPercent"
            :disabled="!imagePath"
            data-test="bg-dim"
            @input="onDimInput"
            @change="onDimChange"
          />
          <span class="val" data-test="bg-dim-value">{{ dimPercent }}%</span>
        </div>
        <p class="hint">图片上方的黑色遮罩，越高文字越清晰。</p>
      </section>

      <section data-test="auto-launch-section">
        <h4>启动</h4>
        <div class="row">
          <label class="check" data-test="auto-launch-label">
            <input
              type="checkbox"
              :checked="autoLaunch.enabled"
              data-test="auto-launch"
              @change="onAutoLaunchChange"
            />
            开机时自动启动 TagTerm
          </label>
          <span v-if="autoLaunch.blockedBySystem" class="hint" data-test="auto-launch-blocked">
            已在系统「启动应用」中被禁用
          </span>
        </div>
      </section>

      <section>
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
          <span class="hint" data-test="update-status">{{ updateText }}</span>
        </div>
      </section>

      <section>
        <h4>关于</h4>
        <div class="about">
          <span data-test="about-version">TagTerm v{{ version }}</span>
          <span class="hint">数据目录</span>
          <span class="path mono" data-test="about-data-dir">{{ dataDir }}</span>
        </div>
      </section>

      <p v-if="error" class="error" data-test="settings-error">{{ error }}</p>
      <div class="actions">
        <button class="btn primary" type="button" data-test="settings-done" @click="emit('close')">
          完成
        </button>
      </div>
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
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  padding: 18px 20px;
}
.modal h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
section {
  padding: 10px 0;
  border-top: 1px solid var(--line);
}
section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.row label {
  font-size: 12.5px;
  color: var(--muted);
}
.row input[type='range'] {
  flex: 1;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.val {
  font-size: 12.5px;
  min-width: 36px;
  text-align: right;
}
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  padding: 3px 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
}
.mono {
  font-family: var(--mono);
}
.about {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.warn {
  margin: 0 0 8px;
  font-size: 12px;
  color: #b45309;
}
.error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #b42318;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
