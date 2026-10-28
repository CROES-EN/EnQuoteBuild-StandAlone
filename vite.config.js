import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'
import {fileURLToPath, URL} from 'node:url'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  logLevel: 'error', // Suppress warnings, only show errors
  server: {
    allowedHosts: ['enquote-sync.enphase-enquote.com'],
    // Proxy /auth requests to the Worker so the browser can call /auth/login,
    // /auth/register, /auth/session without CORS issues during development.
    // In production (Worker serves the UI), these are same-origin.
    proxy: {
      '/auth': {
        target: 'https://enphase-enquote.com',
        changeOrigin: true,
      },
      '/api/browser': { target: 'https://enphase-enquote.com', changeOrigin: true },
      '/api/web-snapshot': { target: 'https://enphase-enquote.com', changeOrigin: true },
      '/api/web-entities': { target: 'https://enphase-enquote.com', changeOrigin: true },
    },
  },
  optimizeDeps: {
    // The renderer and Electron share this CommonJS schema; prebundle it for browser ESM.
    include: ['enquote-refund-form']
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'enquote-refund-form': fileURLToPath(new URL('./shared/refundForm.cjs', import.meta.url))
    }
  },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      visualEditAgent: true
    }),
    react(),
  ]
});
