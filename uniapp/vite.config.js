import { defineConfig, loadEnv } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

const BACKEND = process.env.DM_BACKEND || 'http://127.0.0.1:8000'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [uni()],

    define: {
      /**
       * 真机联调用的后端地址，从 uniapp/.env.local 读（已 gitignore）。
       *
       * 为什么不直接在源码里写 import.meta.env.VITE_DEV_API_BASE：
       * 条件编译是**构建期**裁剪，而单元测试在纯 Node 里跑 ——
       * 那边 `// #ifdef` 只是普通注释、块内的代码照样执行，
       * 但 Node 里 `import.meta.env` 是 undefined，一访问就抛
       * "Cannot read properties of undefined"。
       *
       * 改成注入一个全局标识符，源码里用 typeof 判断，
       * 这样构建产物和 Node 两边都安全。
       */
      __DEV_API_BASE__: JSON.stringify(env.VITE_DEV_API_BASE || ''),
    },

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
  }
})
