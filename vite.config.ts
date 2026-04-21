import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { vitePluginEvalIO } from './scripts/vite-plugin-eval-io'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vitePluginEvalIO()],
})
