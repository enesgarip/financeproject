import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'node:path'

// Source maps are uploaded to Sentry only when SENTRY_AUTH_TOKEN is present
// (i.e. the production build on Vercel). Locally/without a token the plugin is
// disabled, so dev and ordinary builds are unaffected.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG ?? 'enes-je',
      project: process.env.SENTRY_PROJECT ?? 'javascript-react',
      authToken: sentryAuthToken,
      disable: !sentryAuthToken,
      // Upload the .map files, then delete them from the build output so they
      // are never served publicly.
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.js.map'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // 'hidden' emits source maps (for Sentry to symbolicate minified stack
    // traces) without leaving a //# sourceMappingURL comment in the shipped JS,
    // so the maps are not referenced/exposed to end users.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui-utils': ['class-variance-authority', 'clsx', 'tailwind-merge'],
          'vendor-recharts': ['recharts'],
          'vendor-radix': ['radix-ui'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
