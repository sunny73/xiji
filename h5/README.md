# 分红管家 · H5 预览

在浏览器里看小程序长什么样，**不用装微信开发者工具、不用 AppID**。

```bash
cd h5
node build.js      # 打包（改了 miniprogram/ 下的东西要重跑）
node server.js     # → http://127.0.0.1:3000
```

前提：后端在跑，并且有数据（`backend/scripts/seed_demo.py`）。

---

## 它是什么

**跑的是真实的小程序代码**：

| 复用的 | 说 明 |
|---|---|
| WXML 模板 | 同一份文件，由 `runtime/wxml.js` 编译 |
| WXSS 样式 | 同一份文件，转换后使用 |
| 页面 JS | 同一份代码，`Page({...})` / `setData` / `onShow` 都照常工作 |
| `services/` 网络层 | 一行不改，包括 401 自动重登 |

**替换掉的**：`wx.*` 系列 API → 浏览器实现（`runtime/wx-shim.js`）。
`wx.request` 走 `fetch`、storage 走 `localStorage`、picker 用底部弹层模拟。

## 它不是什么

**这不是能上线的 H5。** 差别在于：

- 原生组件（picker、下拉刷新、分享、订阅消息）只是**模拟**，行为和真机有差异
- tabBar / 导航栏是我们自己画的，不是微信运行时的
- 没有小程序的双线程模型、没有 `wx:key` 的复用优化
- **最终验收必须在微信开发者工具里做**

它的定位是：改完 UI 想立刻看一眼时，不用等 DevTools 启动；以及让没有装 DevTools 的人也能看效果。

---

## 目录

```
h5/
├── build.js              打包器：小程序 + 运行时 → dist/bundle.js
├── server.js             静态服务 + /api 反向代理（绕开 CORS）
├── index.html            预览外壳（手机壳 + 左侧说明）
├── preview.css           外壳样式 + toast/弹窗/选择器（小程序里的原生组件）
├── runtime/
│   ├── expr.js           {{ }} 表达式求值（Proxy 作用域，缺失字段不抛异常）
│   ├── units.js          WXSS 转换：rpx→px、page→.wx-page
│   ├── wxml.js           WXML → HTML 字符串（纯函数，可 Node 测试）
│   ├── ui.js             toast / modal / actionSheet / picker 的 DOM 实现
│   ├── wx-shim.js        wx.* → 浏览器
│   ├── router.js         页面栈、setData、事件委托、tabBar
│   ├── boot.js           启动顺序：改 config → 装全局 → 跑 app.js → 启动路由
│   └── loader.js         模块加载器（由 build.js 追加到 bundle 末尾）
└── tests/
    ├── run.js            单元测试（102 个）
    ├── render.js         逐页无头渲染 + 跨页数字一致性（11 个页面）
    └── interactive.html  浏览器内交互自检（24 项）
```

---

## 三个设计决定

**1. 渲染成 HTML 字符串，而不是操作 DOM。**
`wxml.render(ast, data)` → `{ html, pickers }` 是纯函数，所以能在 Node 里跑测试。
需要真实 DOM 的部分（事件委托、焦点恢复、picker 弹层）拆到 `router.js` / `ui.js`。

**2. 事件用委托，不逐个绑定。**
渲染时把 `bindtap="go"` 写成 `data-wx-tap="go"`，容器上挂一次监听，
点击时从目标往上找 `data-wx-tap`，遇到 `data-wx-catch` 就停 —— 这样 `bind` 冒泡和
`catch` 阻断的语义都对。

**3. 打包器会拒绝预览不支持的语法。**
`build.js` 扫描所有 WXML，遇到渲染器没实现的标签/指令/事件就**直接报错**，而不是渲染成空白。
预览是"用另一套渲染器解释同一份模板"，不检查的话，某个页面会静默跑歪而真机正常 ——
那是最难查的一类问题。

---

## 测试

```bash
cd h5

node build.js                # 打包（含 WXML 语法校验 + bundle 语法自检）
node tests/run.js            # 102 个单元测试：表达式、WXSS 转换、WXML 渲染
node tests/render.js         # 11 个页面用无头 Chrome 真渲染 + 跨页数字一致性
                             # （需要 Chrome，且 server.js 在跑）
```

交互自检在浏览器里跑：

```
http://127.0.0.1:3000/tests/interactive.html
```

它会模拟点击 tabBar、点列表行、输入、点 picker，把结果打在页面上。
无头跑法：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --virtual-time-budget=20000 \
  --dump-dom "http://127.0.0.1:3000/tests/interactive.html"
```

### 这层测试真的抓到过东西

搭好预览跑第一遍时，逐页渲染直接暴露了 3 个**小程序里也存在的真 bug**：

| bug | 表现 | 为什么以前没发现 |
|---|---|---|
| 后端 `RecentDividend` 漏了 `shares`/`per_share` | 首页「最近记录」显示 `0 股 × 0` | 后端测试不检查序列化字段；前端单测用的是"我以为的"数据形状 |
| 统计页没传 `status` | 标题写"全年到账"，数字却是已到账+待收 | 单页看没问题，只有和首页对比才发现对不上 |
| `disabled="{{false}}"` 被当成禁用 | 所有 picker 点了没反应 | `hasAttr` 判断属性存在性，而模板里属性一直在、值是 false |

所以现在 `tests/render.js` 里有一条**跨页一致性**检查：
首页、分红页、统计页的"已到账"必须是同一个数字。

---

## 深链

可以直接打开某个页面（排查问题时很有用）：

```
http://127.0.0.1:3000/?page=/pages/holdings/index
http://127.0.0.1:3000/?page=/pages/holding-detail/index?id=<持仓id>
```

---

## 已知差异

| 项 | 预览 | 真机 |
|---|---|---|
| 日期选择器 | 浏览器原生 `input[type=date]` | 微信原生滚轮 |
| 下拉刷新 | 浏览器自己的滚动 | 微信下拉动画（`stopPullDownRefresh` 是空实现） |
| 输入框 `type="digit"` | `inputmode="decimal"` | 数字键盘 |
| 字体 | 系统字体 | 微信内置字体 |
| 启动画面 / 分包 | 无 | 有 |

---

## 常见问题

**页面空白 / 显示「预览启动失败」**
左侧面板会显示错误的堆栈。多数是后端没起，或没跑 `seed_demo.py`。

**数据全是 0**
接口连上了但该用户没数据。默认登录身份是 `dev-local-user`，
和 `miniprogram/utils/config.js` 里的 `devOpenid` 一致。

**改了小程序代码没生效**
要重新 `node build.js`。预览不监听文件变化（没装任何 npm 依赖，不做 watcher）。

**接口 502**
`server.js` 代理到 `http://127.0.0.1:8000`，后端没起时会返回带提示的 502。
换后端地址：`node server.js --api http://192.168.1.8:8000`
