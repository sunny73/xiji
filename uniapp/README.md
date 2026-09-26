# 分红管家 · uni-app 前端

同一套代码发 **微信小程序 + H5**。Vue 3 + Vite。

> 仓库里还有一份**原生小程序版**（`miniprogram/`）和它的 H5 预览运行时（`h5/`）。
> 那些已经**冻结**，只作为参考保留。新功能只改这一份。

---

## 快速开始

```bash
cd uniapp
npm install          # 走 npmmirror 镜像（.npmrc 已配）

npm run dev:h5       # → http://127.0.0.1:5173（vite 代理 /api 到后端，不用改 CORS）
npm run dev:mp-weixin # 用微信开发者工具导入 dist/dev/mp-weixin
```

前提：后端在跑（`docker compose up -d`），并且有数据（`backend/scripts/seed_demo.py`）。

### 构建

```bash
npm run build:h5         # → dist/build/h5（纯静态，可直接丢 CDN）
npm run build:mp-weixin  # → dist/build/mp-weixin（用开发者工具导入、上传）
```

H5 产物本地预览（带 /api 代理）：

```bash
node scripts/serve.js    # → http://127.0.0.1:5174
```

---

## 目录

```
uniapp/
├── package.json / vite.config.js / index.html
├── src/
│   ├── main.js             createSSRApp 入口（uni-app 固定写法）
│   ├── App.vue             全局样式（= 原版 app.wxss）+ onLaunch 静默登录
│   ├── pages.json          路由 + tabBar（= 原版 app.json）
│   ├── manifest.json       各平台配置（appid、H5 路由模式等）
│   ├── package.json        只为让 Node 把 src 下的 .js 当 ESM 解析，见「坑」
│   ├── static/tabbar/      tabBar 图标（从原生版复制过来的，同一套）
│   ├── utils/              纯函数：格式化/校验/日历/装饰/守卫/标的解析
│   ├── services/           http ← auth ← api（单向依赖）
│   └── pages/<名>/index.vue
├── scripts/serve.js        H5 产物预览服务器（静态 + /api 代理）
└── tests/
    ├── run.mjs             251 个单元测试
    ├── render.mjs          11 个页面的无头 Chrome 渲染 + 跨页一致性
    └── structure.mjs       15 项静态结构校验
```

---

## 从原生版复用了多少

| | 处理方式 | 行数 |
|---|---|---|
| `utils/` + `services/` | **逻辑一行没改**，只做 CommonJS→ESM 和 `wx.`→`uni.` 的机械转换 | 1313 |
| 单元测试 | 同上，测试用例原样保留 | — |
| tabBar 图标 | 直接复制（本来就是脚本生成的） | — |
| WXSS 样式 | **几乎原样**搬进 SFC 的 `<style scoped>`（uni-app 原生支持 rpx） | — |
| 10 个页面 | 重写成 Vue SFC | 3940 |
| `h5/` 自研渲染器 | **不再需要**（uni-app 自己就能构建 H5） | — |

所以不是从零重写：**约 40% 的代码（含测试）直接可用**。

---

## 和原生版的行为差异

| 项 | 原生版 | uni-app 版 |
|---|---|---|
| 页面状态 | `this.data` + `setData` | `ref` / `computed` |
| 生命周期 | `onShow() {}` | `onShow(() => {})`（从 `@dcloudio/uni-app` 导入） |
| 条件渲染 | `wx:if` / `wx:elif` / `wx:else` | `v-if` / `v-else-if` / `v-else` |
| 列表 | `wx:for` + `wx:key` | `v-for` + `:key` |
| 事件 | `bindtap` / `catchtap` | `@tap` / `@tap.stop` |
| 分组 | `<block>` | `<template>` |
| 金额预览 | 手动在 input 回调里重算 | `computed`（少一处 `this` 绑定坑） |
| 日历行 | 手写 `buildRows()` 并在 `setData` 时重建 | `computed` 自动重算 |
| 账户页操作菜单 | `wx.showActionSheet` 弹两层 | 点行直接进编辑表单，删除按钮在表单里 |

**业务规则完全一致**：金额只由后端算、越权返回 404、请求竞态守卫、
标的缓存必须比对 code —— 这些都在 `utils/` 和 `services/` 里，两版共用。

---

## 测试

```bash
cd uniapp
node tests/run.mjs        # 251 个单元测试（零依赖，不需要后端）
node tests/structure.mjs  # 15 项静态检查（不需要后端）
node tests/render.mjs     # 11 个页面无头渲染（需要 build:h5 + serve.js + 后端）
```

三个层次各管什么：

| | 管什么 | 抓不到的 |
|---|---|---|
| `run.mjs` | 纯逻辑：金额格式化、日期、校验、装饰层、401 重登、竞态守卫 | 页面渲染、Vue 语法 |
| `structure.mjs` | pages.json ↔ .vue 是否对得上、tabBar 图标、残留 `wx.`、`this` 误用、生产配置安全性、构建产物完整性 | 运行时行为 |
| `render.mjs` | **真跑一遍**：Vue 渲染、真实接口、真实数据、跨页数字一致性 | 真机差异 |

`structure.mjs` 做过变异验证（删文件 / 写 `this.` / 写 `wx.` 都确实会红），不是空跑。

---

## 四个坑（都踩过）

### 1. npm 官方源在这台机器上不通

和 Docker Hub 一样被墙。`.npmrc` 已配成 npmmirror：

```
registry=https://registry.npmmirror.com
```

装依赖时缓存目录要指到工作区内（沙箱要求）：

```bash
npm_config_cache="$(git rev-parse --show-toplevel)/.npm-cache" npm install
```

### 2. `vite` 必须锁在 5.2.8

`@dcloudio/vite-plugin-uni` 的 `peerDependencies` 是**精确版本** `vite: 5.2.8`，
装上 vite 8 会直接报错。`package.json` 里已经写死，别手贱升级。

同理所有 `@dcloudio/*` 必须是**同一个日期版本**（现在是 `3.0.0-5020620260917001`），
混版会出现莫名其妙的编译错误。

### 3. npm 11 默认不跑 install 脚本

装完依赖后 `esbuild` 的二进制可能没准备好，报「esbuild 不可用」。补一条：

```bash
npm rebuild esbuild
```

### 4. 条件编译在纯 Node 下**照样执行**

`src/utils/config.js` 里用 `// #ifdef H5` 区分 H5 和小程序的接口地址：

```js
let devBase = PROD_BASE
// #ifdef H5
devBase = '/api/v1'
// #endif
```

构建时 uni-app 会**裁掉**不成立的分支，但在纯 Node（比如单元测试）里
`// #ifdef` 只是普通注释，块内的赋值**照样执行** —— 所以 Node 里 `devBase` 是 `/api/v1`。
写测试断言时要记得这一点。

### 5. `src/package.json` 是故意的

根 `package.json` 不能设 `type: module`（uni CLI 是 CommonJS）。
但 `src/**/*.js` 用的是 ESM 语法，Node 会按根配置把它们当 CJS，测试就 import 不了。
所以在 `src/` 里放一个只声明 `{"type":"module"}` 的 package.json。
Vite 本来就按 ESM 处理，不受影响。

---

## 发布

和原生版**完全一样**——uni-app 不改变微信的审核规则。

⚠️ 上架前必读 [../docs/PUBLISH.md](../docs/PUBLISH.md) 第一节：
小程序服务类目对「金融信息」有资质门槛，个人主体可能选不了对应类目。
**这是上架最大的未知数，换框架解决不了。**

发布步骤的差异只有一处：小程序后台配置好 request 合法域名后，
把 `src/utils/config.js` 的 `ENV` 改成 `'prod'`、`PROD_BASE` 改成你的域名，
然后 `npm run build:mp-weixin`，用开发者工具导入 `dist/build/mp-weixin` 上传。

H5 部署：`npm run build:h5` 的产物是纯静态文件，丢到 Nginx/CDN 即可。
注意 H5 的接口地址是 `PROD_BASE`（完整域名），需要后端开 CORS 或同域反代 ——
Nginx 配置参考 [../deploy/nginx.conf](../deploy/nginx.conf)。
