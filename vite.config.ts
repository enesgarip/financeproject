import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Sentry kaldirildiktan sonra source map'i tuketen kimse kalmadi; uretime
    // sunulmayan harita uretmek bosuna build maliyeti + sizinti yuzeyi.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-ui-utils': ['class-variance-authority', 'clsx', 'tailwind-merge'],
          'vendor-radix': ['radix-ui'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
