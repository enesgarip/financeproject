import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui-utils': ['class-variance-authority', 'clsx', 'tailwind-merge'],
          'vendor-motion': ['framer-motion'],
          'vendor-recharts': ['recharts'],
          'vendor-radix': ['radix-ui'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
