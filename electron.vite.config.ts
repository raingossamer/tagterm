import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const sharedDir = resolve(__dirname, 'src/shared')

/**
 * CSP 的 connect-src 只在开发期放开 Vite HMR 的 WebSocket，
 * 生产构建保持 'self'（Plan §5 安全策略）。
 */
function cspPlugin(isDev: boolean): Plugin {
  const connectSrc = isDev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'"
  return {
    name: 'tagterm-csp',
    transformIndexHtml(html) {
      return html.replace('__CSP_CONNECT__', connectSrc)
    },
  }
}

export default defineConfig(({ command }) => {
  const isDev = command === 'serve'
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: { '@shared': sharedDir } },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: { '@shared': sharedDir } },
    },
    renderer: {
      plugins: [vue(), cspPlugin(isDev)],
      resolve: { alias: { '@shared': sharedDir } },
    },
  }
})
