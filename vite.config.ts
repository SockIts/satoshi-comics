import { defineConfig } from 'vite'
import type { ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'https://fakefull.art/api'
const API_PROXY_ORIGIN = process.env.VITE_API_PROXY_ORIGIN || new URL(API_PROXY_TARGET).origin
const ADMIN_PROXY_TARGET = process.env.VITE_ADMIN_PROXY_TARGET || API_PROXY_ORIGIN
const API_PROXY_REWRITE_PREFIX = API_PROXY_TARGET.endsWith('/api') ? '' : '/v2'
const COMPOSE_PROXY_REWRITE_PREFIX = API_PROXY_TARGET.endsWith('/api') ? '/api' : API_PROXY_REWRITE_PREFIX

const configureLongRequestProxy: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('proxyReq', (proxyReq, req) => {
    const contentLength = req.headers['content-length']
    if (contentLength) {
      const sizeMB = (parseInt(contentLength, 10) / (1024 * 1024)).toFixed(2)
      console.log(`[Proxy] ${req.method} ${req.url} (${sizeMB} MB)`)
    } else {
      console.log(`[Proxy] ${req.method} ${req.url}`)
    }
    proxyReq.setTimeout(0)
  })
  proxy.on('error', (err, req) => {
    console.error(`[Proxy Error] ${req.method} ${req.url}:`, err.message)
  })
  proxy.on('proxyRes', (proxyRes, req) => {
    console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`)
  })
}

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
  ],
  server: {
    proxy: {
      '/api/compose': {
        target: API_PROXY_ORIGIN,
        changeOrigin: true,
        rewrite: (proxyPath) => proxyPath.replace(/^\/api/, COMPOSE_PROXY_REWRITE_PREFIX),
        configure: configureLongRequestProxy,
      },
      '/admin': {
        target: ADMIN_PROXY_TARGET,
        changeOrigin: true,
        configure: configureLongRequestProxy,
      },
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        rewrite: (proxyPath) => proxyPath.replace(/^\/api/, API_PROXY_REWRITE_PREFIX),
        configure: configureLongRequestProxy,
      },
    },
  },
})
