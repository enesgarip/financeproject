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
        // Fonksiyon formu şart: obje formundaki 'react-dom' kaydı yalnız
        // react-dom/index'i eşliyordu, main.tsx'in import ettiği
        // react-dom/client (ve supabase + tanstack) 138 kB'lık entry'de
        // kalıyordu — her deploy'da app koduyla birlikte yeniden iniyordu.
        // Aylarca değişmeyen vendor'lar ayrı chunk'ta tarayıcı cache'inde kalır.
        manualChunks(id: string) {
          const normalized = id.replace(/\\/g, '/')
          if (!normalized.includes('node_modules')) return undefined
          // pdfjs-dist yalnız lib/pdfText.ts'ten dinamik import edilir; bir
          // vendor chunk'ına sabitlemek onu kritik yola çeker. Dokunma.
          if (normalized.includes('node_modules/pdfjs-dist/')) return undefined
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(normalized)) return 'vendor-react'
          if (normalized.includes('node_modules/@supabase/')) return 'vendor-supabase'
          if (normalized.includes('node_modules/@tanstack/')) return 'vendor-query'
          // İkonlar tek deterministik chunk'ta: 51 adet <2 kB'lık ikon chunk'ı
          // (her biri ayrı HTTP isteği) yerine bir kez inip cache'lenen tek dosya.
          if (normalized.includes('node_modules/lucide-react/')) return 'vendor-icons'
          if (/node_modules\/(radix-ui|@radix-ui|class-variance-authority|clsx|tailwind-merge)\//.test(normalized)) return 'vendor-ui'
          return undefined
        },
        // Kalan cüce chunk'ları (paylaşılan 1-2 kB'lık modüller) komşularına kat.
        experimentalMinChunkSize: 20_000,
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
