import { createSSRApp } from 'vue'
import App from './App.vue'

// uni-app 的 Vue3 入口固定长这样：导出一个 createApp 工厂，而不是直接 createApp
export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
