import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)), '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000', '/content': 'http://localhost:3000', '/legacy': 'http://localhost:3000' } },
})
