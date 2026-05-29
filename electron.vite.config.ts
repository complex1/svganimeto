import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    publicDir: 'public',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    /**
     * `es` format is required so workers can use dynamic `import()` for
     * lazy-loaded WASM (potrace, etc.). Modern Electron / Chromium fully
     * supports ES module workers, so there's no compatibility cost.
     */
    worker: {
      format: 'es'
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    plugins: [react()]
  }
})
