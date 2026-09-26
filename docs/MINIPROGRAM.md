# 分红管家 · 微信小程序前端

## 怎么跑起来

1. 装 **微信开发者工具**（[下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)）
2. 启动后端（二选一）：
   ```bash
   docker compose up -d && docker compose exec api alembic upgrade head
   # 或
   cd backend && .venv/bin/uvicorn app.main:app --reload
   ```
3. **首次必须先扫码登录**（这个版本没有游客模式，停在二维码页时什么都打不开）
4. 开发者工具 → **导入项目** → 目录选 `miniprogram/` → AppID 那栏点 **「测试号」**
   - ⚠️ 仓库里的 `project.config.json` 写的是 `touristappid`（无 AppID 模式的占位符），
     **这个版本已经废弃**，直接用会报「不存在此 AppID」。
     DevTools 导入时会把真实的测试号 AppID 写回该文件。
5. **必须做的一步**：详情 → 本地设置 → 勾选 **「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」**
   否则 `http://127.0.0.1:8000` 会被拦掉，报「请求域名未配置」。

> 装开发者工具、开 CLI 服务端口等环境问题见 [SETUP-MACOS.md](SETUP-MACOS.md) 第三章。

### 不想装开发者工具？

用 **H5 预览**：`cd h5 && node build.js && node server.js` → <http://127.0.0.1:3000>

它跑的是真实的小程序代码（同一份 WXML/WXSS/页面 JS），只把 `wx.*` 换成了浏览器实现。
是**预览**不是能上线的 H5，详见 [h5/README.md](../h5/README.md)。

### 真机预览

手机上的 `127.0.0.1` 是手机自己，连不到你的电脑。改 `utils/config.js`：

```js
baseUrl: 'http://192.168.1.8:8000/api/v1',   // 换成你电脑的局域网 IP
```

`ifconfig | grep "inet "` 可以查。同时确保手机和电脑在同一个 Wi-Fi 下，且后端监听 `0.0.0.0`（uvicorn 加 `--host 0.0.0.0`）。

---

## 目录结构

```
miniprogram/
├── app.js / app.json / app.wxss     全局入口、路由与 tabBar、设计变量与公共样式
├── project.config.json              开发者工具项目配置（urlCheck 已关，方便本地调试）
├── assets/tabbar/*.png              tabBar 图标（用 tools/ 下的脚本生成，非手工绘制）
├── pages/                           10 个页面，每个 4 个文件
│   ├── home/                        首页：已到账 / 预计 / 待收 / 下一笔 / 最近记录
│   ├── holdings/                    持仓列表（按账户筛选）
│   ├── holding-detail/              持仓详情：改股数成本、看该标的历史分红、删除
│   ├── holding-create/              添加持仓
│   ├── dividends/                   分红列表（状态/年份筛选 + 触底分页 + 确认到账）
│   ├── dividend-create/             记一笔 / 编辑分红（含金额实时预览）
│   ├── calendar/                    分红日历（月历 + 点某天看当天明细）
│   ├── statistics/                  统计（年切换 + 月度柱状图 + 按标的 + 历年）
│   ├── profile/                     我的（昵称、账户入口、开发工具）
│   └── accounts/                    投资账户管理
├── services/                        网络层（三层单向依赖）
│   ├── http.js                      wx.request → Promise，只做网络，不碰 token
│   ├── auth.js                      token 存储、登录、切换开发身份
│   └── api.js                       业务接口 + 401 自动重登 + 错误翻译
├── utils/
│   ├── config.js                    ★ 环境配置（baseUrl / devOpenid）
│   ├── format.js                    金额、日期、倒计时格式化
│   ├── validate.js                  表单校验
│   ├── security.js                  标的输入解析（代码变了必须作废旧缓存）
│   ├── seq.js                       请求序号守卫（丢弃过期响应）
│   ├── decorate.js                  ★ 后端原始对象 → 模板可直接渲染的结构
│   ├── calendar.js                  月历网格计算
│   ├── constants.js                 枚举与中文标签
│   └── ui.js                        toast / loading / confirm 统一封装
├── tools/gen_tabbar_icons.py        生成 tabBar 图标（纯标准库，可复现）
└── tests/                           测试
    ├── run.js                       单元测试入口（零依赖）
    ├── integration.js               前后端契约测试（需要后端在跑）
    ├── pages.test.js                页面级回归测试（每个都对应一次修过的真 bug）
    ├── page-harness.js              让页面模块能在 Node 里被实例化
    └── harness.js                   极简测试框架 + wx 替身
```

### 三个分层约定

**`services/` 是单向依赖：`http.js ← auth.js ← api.js`。**
`http.js` 只管把 `wx.request` 包成 Promise；token 和重登在 `auth.js` / `api.js`。
这样拆是为了避免循环依赖——`api.js` 401 时要调 `auth.login()`，而 `auth.login()` 又要发请求。

**页面不直接调 `wx.request`，也不自己格式化金额。**
所有接口调用走 `api.js`，所有展示字段走 `decorate.js`。好处是业务规则只有一处实现，
也让这一层可以在 Node 里跑测试（页面渲染部分测不了）。

**金额只在后端算。**
`decorate` / `format` 里的计算**只用于显示**。`dividend-create` 页面会实时预览
「股数 × 每股分红」，但那只是给用户看的，提交时请求体里**没有 amount 字段**——
后端 schema 是 `extra="forbid"`，传了直接 422。`api.js` 里有一条测试专门守这个约定。

---

## 测试

```bash
cd miniprogram

node tests/run.js            # 277 个单元测试，零依赖，不需要后端
node tests/integration.js    # 43 项前后端契约测试，需要后端在跑
```

`tests/run.js` 覆盖：

| 文件 | 测什么 |
|---|---|
| `format` | 金额千分位/四舍五入、日期解析（不用 `new Date(str)`，避开时区差一天）、跨夏令时的天数计算 |
| `validate` | 拒绝 `1e3`/`0x10`/负数这类 `Number()` 会放过的输入；`2026-02-31` 这类假日期 |
| `calendar` | 闰年、跨年补位、固定 6 行网格（避免月份切换时高度跳动） |
| `decorate` | 后端原始对象 → 展示字段；缺字段/null 不崩 |
| `api` | 401 重登**只重放一次**（防死循环）、并发 401 只登录一次、错误翻译不出现 `[object Object]` |
| `security` | 「表单显示 A、实际写 B」——改了代码必须作废旧缓存 |
| `seq` | 请求序号守卫：过期响应必须被丢弃 |
| `pages` | **页面级状态机**（见下） |
| `structure` | **静态检查**（见下） |

### `pages.test.js` 特别值得说

页面模块依赖全局的 `Page()`，本来在 Node 里跑不起来。但**最容易出 bug 的恰恰是页面层**——
一次独立代码审查在这层找到了 3 个会写错数据 / 丢数据的 P0。

`tests/page-harness.js` 用一个临时 `Page` 全局把配置对象接住，再造一个带 `data`/`setData`
的假页面实例，于是 `reload()` / `onReachBottom()` / `onCodeInput()` 这些方法就能像普通对象一样测。

`pages.test.js` 里**每一条都对应一次真实修过的 bug**，并且都做过变异验证
（把修复还原回去，确认测试确实会红）：

| 回归测试 | 原来的 bug |
|---|---|
| 改标的代码后必须清空缓存的 `security` | 查完 601988 改成 601857 再保存，持仓会记到 601988 上 |
| `ensureSecurity` 不复用 code 对不上的缓存 | 同上，且用户极难发现 |
| 查询失败时置 `notFound` | 名称输入框不渲染，用户被卡在"请填写标的名称"却无处可填 |
| 清空代码作废在途查询 | 旧响应把已清掉的标的又填回来 |
| `reload` 复位 `hasMore` | 列表清空但 `hasMore` 仍为 true，用户一滑就让第 1 页失效，**前 20 条静默消失** |
| 分页不递增守卫 | 同上 |
| 持仓筛选丢弃过期响应 | 快速连点两个账户，高亮是 B、列表内容是 A |
| 缺 `?id` 时结束 loading | 页面永远停在"加载中…" |

### `structure.test.js` 特别值得说

小程序渲染没法在 Node 里跑，但很多低级错误是静态就能抓的。它会检查：

- `app.json` 声明了页面，但 `.js/.wxml/.json/.wxss` 文件没建全
- tabBar 图标路径写错 / 文件不存在 / 超过 40KB
- **WXML 里 `bindtap="save"` 但 JS 里没有 `save` 方法**（点击毫无反应，要手点才发现）
- **模板里引用了 `data` 里不存在的字段**（渲染成空白）
- WXML 标签没闭合
- `wx:for` 少了 `wx:key`
- **回调里的 `this` 没绑定**（`arr.map(function (x) { return this.data.y })`——数组一非空整个页面就崩）
- **`setData(data, this.method)` 这种裸方法引用**（微信官方没规定回调的 `this`，必须 `.bind(this)`）
- `require` 了不存在的模块
- `api.js` 里出现构造 `amount` 的代码
- `prod` 配置里偷偷开了 `devLogin` 降级

这些检查本身也做过变异测试：手动改坏一处，确认测试确实会红（不是空跑）。

**已知盲区**（写在文档里，免得下次又漏）：

- `wx:for="{{x.y}}"` 这种**成员路径**只检查顶层名 `x` 是否存在，
  看不出 `buildRows()` 把返回结构从数组改成 `{key, cells}` 之类**结构性变化**。
  改这类代码时要手动同步 WXML，测试拦不住。
- 静态检查只管"引用存在性"，管不了"值对不对"。业务逻辑的正确性靠
  `pages.test.js` 和 `integration.js`。

---

## 关于开发环境的登录

后端 `WECHAT_MOCK=true` 时，openid 是由 `code` 推导的。而开发者工具**每次 `wx.login` 返回的 code 都不一样**——
如果直接走微信登录流程，**每次启动都会变成一个新用户，刚录的数据看起来就"消失"了**。

所以 `utils/config.js` 里 dev 环境默认走：

```js
devOpenid: 'dev-local-user',   // 固定 openid，直接调 /auth/dev-login
```

「我的 → 开发工具 → 切换开发身份」可以换成别的 openid 登录，
用来验证**多用户数据隔离**（A 用户看不到 B 用户的账户和分红）。

上线前把 `ENV` 改成 `'prod'`，并确认 `backend/.env` 里：

```
WECHAT_MOCK=false
ALLOW_DEV_LOGIN=false
```

---

## tabBar 图标是怎么来的

不依赖图标库，用 `tools/gen_tabbar_icons.py` 生成（纯标准库，直接写 PNG，不装 Pillow）：

```bash
python3 tools/gen_tabbar_icons.py
```

原理是给每个图标定义一个 `inside(x, y) -> bool` 的形状函数，每个像素做 4×4 超采样求覆盖率当 alpha，
天然带抗锯齿。改形状只需要改那个函数，重新跑一遍即可。

---

## 已知限制

- **没有分包**。10 个页面 + 无第三方库，主包体积远低于 2MB 限制，暂时不需要。
- **没有图表库**。月度柱状图是纯 WXSS 画的（12 个 `view` 设高度百分比），
  为了 12 根柱子引入图表库不值当。
- **头像不支持自定义上传**。`chooseAvatar` 拿到的是本地临时路径，跨设备无意义；
  要真的支持得先做文件上传接口，第一版用昵称首字做占位。
- **`wx.showModal` 的 `editable` 需要较新的基础库**。切换开发身份用到了它，
  低版本基础库上会退化成无输入框。这只是开发工具，不影响正式用户。
