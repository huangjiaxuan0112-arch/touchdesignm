import react from '@vitejs/plugin-react'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig(({ mode }) => {
  const devCspNonce = mode === 'production' ? '' : randomBytes(24).toString('base64')

  return {
    main: {
      define: {
        __NATURE_TOUCH_DEV_CSP_NONCE__: JSON.stringify(devCspNonce),
      },
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'electron/main.ts'),
          },
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            preload: resolve(__dirname, 'electron/preload.ts'),
          },
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
          },
        },
      },
    },
    renderer: {
      root: resolve(__dirname, 'renderer'),
      html: devCspNonce ? { cspNonce: devCspNonce } : undefined,
      plugins: [react()],
      build: {
        rollupOptions: {
          input: resolve(__dirname, 'renderer/index.html'),
        },
      },
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'shared'),
        },
      },
    },
  }
})