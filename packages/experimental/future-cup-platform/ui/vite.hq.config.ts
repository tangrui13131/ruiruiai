import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  publicDir: 'public/hq',
  build: {
    outDir: '../lib/web/hq',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: 'src/hq/bridge.ts',
      name: 'FutureCupHqBridge',
      formats: ['iife'],
      fileName: () => 'hq-bridge.js',
    },
  },
})
