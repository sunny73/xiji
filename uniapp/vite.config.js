import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

const BACKEND = process.env.DM_BACKEND || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [uni()],

  // H5 开发服务器：把 /api 代理到后端。
  // 这样浏览器视角是**同源**的，不需要动后端的 CORS 配置
  // （Docker 里 CORS_ORIGINS 默认是空的，不改就跑不了）。
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/healthz': {
        target: BACKEND,
        changeOrigin: true,
      },
    },
  },
})
