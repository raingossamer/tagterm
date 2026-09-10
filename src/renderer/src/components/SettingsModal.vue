<script setup lang="ts">
// 「设置」弹窗（主窗口内 modal）：终端背景（选图 / 清除 / 遮罩滑块即时预览）、更新（S10 接入）、关于
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'

const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()

const version = ref('')
const dataDir = ref('')
const error = ref('')

const imagePath = computed(() => settings.settings.terminalBackground.imagePath)
const dimPercent = computed(() => Math.round(settings.terminalBackground.dimOpacity * 100))
const isImageMissing = computed(() => !!imagePath.value && settings.backgroundImage === null)

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  try {
    ;[version.value, dataDir.value] = await Promise.all([
      window.tagterm.app.getVersion(),
      window.tagterm.app.getDataDir(),
    ])
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

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

      <section>
        <h4>更新</h4>
        <div class="row">
          <button class="btn sm" type="button" disabled data-test="update-check">检查更新</button>
          <span class="hint" data-test="update-status">即将支持</span>
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
