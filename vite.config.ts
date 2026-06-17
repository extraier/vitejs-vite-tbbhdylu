import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // This stops the bundler from crashing when loading our icons
    include: ['lucide-react'] 
  }
})