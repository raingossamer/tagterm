// 本周备忘小窗的入口（memo-floating-window）：只挂备忘录页面与 memo store，window.tagterm 是小窗自己的 preload 给的那一份
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import MemoPanel from '../components/MemoPanel.vue'
import { useMemoStore } from '../stores/memo'
import '../styles/tokens.css'
import '../styles/base.css'

const pinia = createPinia()
createApp(MemoPanel).use(pinia).mount('#app')
void useMemoStore(pinia).load()
