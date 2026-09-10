import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const sharedDir = resolve(__dirname, 'src/shared')

// 两个 project：main（Node 环境，含真实 cmd.exe 集成测试）与 renderer（happy-dom + Vue Test Utils）
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { '@shared': sharedDir } },
        test: {
          name: 'main',
          environment: 'node',
          include: ['tests/main/**/*.test.ts'],
          testTimeout: 20000,
        },
      },
      {
        plugins: [vue()],
        resolve: { alias: { '@shared': sharedDir } },
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['tests/renderer/**/*.test.ts'],
        },
      },
    ],
  },
})
