import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  base: '/',
  build: {
    outDir: '../lib/web',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          flow: ['@xyflow/react'],
          socket: ['socket.io-client'],
          validation: ['zod'],
        },
      },
    },
  },
})
