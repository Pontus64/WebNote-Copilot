# Floating Notes

这是一个部署在 Cloudflare Workers 上的悬浮笔记本。主站是 React 页面，后端 `/notes` API 使用 Cloudflare D1 保存笔记；嵌入脚本和油猴脚本复用同一套 React widget 代码。

## 目录结构

```text
client/app/App.tsx                  主站 React 页面入口
client/shared/FloatingNotesCore.tsx 主站和嵌入脚本复用的抽屉/划词/笔记核心组件
client/shared/floatingNotes.css     主站和嵌入脚本复用的样式
client/widget/entry.tsx             嵌入式 React widget 入口
public/embed/floating-notes-widget.js 构建后的嵌入式 widget 文件
public/embed/inject-floating-notes.js 普通网页一行嵌入入口
public/floating-notes.user.js       油猴脚本安装文件
src/index.ts                        Worker 后端入口，处理 /notes API
migrations/                         D1 数据库迁移
```

## 本地主站调试

安装依赖：

```bash
npm install
```

启动 Vite 开发服务：

```bash
npm run dev -- --port 5174
```

打开主站：

```text
http://127.0.0.1:5174/
```

本地主站用于调试 React 主页面、划词工具栏、右下角悬浮按钮、PC 右侧抽屉、移动端底部抽屉等 UI 行为。

## 本地嵌入脚本调试

启动同一个开发服务后打开：

```text
http://127.0.0.1:5174/embed-demo.html
```

这个页面会加载：

```html
<script
  src="/embed/inject-floating-notes.js"
  data-trigger="#openNotes"
  data-title="笔记">
</script>
```

如果要在其他本地页面测试嵌入，可以放：

```html
<script
  src="http://127.0.0.1:5174/embed/inject-floating-notes.js"
  data-api-base="http://127.0.0.1:5174"
  data-title="笔记">
</script>
```

注意：`public/floating-notes.user.js` 排除了 `localhost` 和 `127.0.0.1`，这是为了避免本地调试时油猴脚本重复注入，导致行为和干净页面不一致。

## D1 数据库

`/notes` API 依赖 D1 表结构。当前迁移文件是：

```text
migrations/0001_create_notes.sql
```

本地 D1 迁移：

```bash
npx wrangler d1 migrations apply wranglerdemo --local
```

线上 D1 迁移：

```bash
npx wrangler d1 migrations apply wranglerdemo --remote
```

`wranglerdemo` 是 `wrangler.jsonc` 里的 D1 binding 名称。修改 D1 binding 后运行：

```bash
npm run cf-typegen
```

## 构建

完整构建：

```bash
npm run build
```

它会先执行 `build:widget`，生成嵌入式脚本产物，再执行主站和 Worker 构建。

单独构建嵌入式 widget：

```bash
npm run build:widget
```

这个命令会把 `client/widget/entry.tsx` 打成 IIFE 文件：

```text
public/embed/floating-notes-widget.js
```

## 部署主站和 API

部署到 Cloudflare Workers：

```bash
npm run deploy
```

等价于：

```bash
npm run build
wrangler deploy
```

部署后访问：

```text
https://notes.edmund.xin/
```

线上 API 验证：

```bash
curl -i https://notes.edmund.xin/notes
```

返回的 `Content-Type` 应该是：

```text
application/json; charset=utf-8
```

Cloudflare Wrangler 参考文档：

- https://developers.cloudflare.com/workers/wrangler/commands/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.cloudflare.com/d1/wrangler-commands/

## 普通网页嵌入

如果能改目标网页源码，直接放：

```html
<script
  src="https://notes.edmund.xin/embed/inject-floating-notes.js"
  data-api-base="https://notes.edmund.xin"
  data-title="笔记">
</script>
```

如果要绑定宿主页面自己的按钮：

```html
<button id="openNotes">打开笔记</button>

<script
  src="https://notes.edmund.xin/embed/inject-floating-notes.js"
  data-api-base="https://notes.edmund.xin"
  data-trigger="#openNotes"
  data-title="笔记">
</script>
```

也可以给任何元素加通用属性：

```html
<a href="#" data-floating-notes-trigger>打开笔记</a>
```

常用 `data-*` 配置：

| 配置 | 作用 |
| --- | --- |
| `data-api-base` | 后端服务地址，widget 会请求 `${apiBase}/notes` |
| `data-title` | 笔记抽屉标题 |
| `data-trigger` | 绑定宿主页面按钮选择器 |
| `data-float-button="false"` | 不显示默认右下角悬浮按钮 |
| `data-open="true"` | 加载完成后自动打开抽屉 |

## 油猴脚本发布和用户安装

油猴脚本安装地址：

```text
https://notes.edmund.xin/floating-notes.user.js
```

用户使用方式：

1. 安装 Tampermonkey。
2. 打开 `https://notes.edmund.xin/floating-notes.user.js`。
3. 在 Tampermonkey 安装页面点击安装或更新。
4. 打开任意普通 HTTP/HTTPS 页面，右下角会出现悬浮笔记按钮。

当前油猴脚本关键配置：

```js
// @version      1.0.6
// @require      https://notes.edmund.xin/embed/floating-notes-widget.js?v=1.0.6
// @connect      notes.edmund.xin
```

修改 `client/widget/entry.tsx`、`client/shared/FloatingNotesCore.tsx` 或 `client/shared/floatingNotes.css` 后，如果要发布给油猴用户，必须同步升级版本号：

```text
client/widget/entry.tsx                  WIDGET_VERSION
public/embed/inject-floating-notes.js    WIDGET_VERSION
public/floating-notes.user.js            @version 和 @require ?v=
```

例如从 `1.0.6` 升到 `1.0.7`。这样可以避免浏览器或 Tampermonkey 继续使用旧的 `floating-notes-widget.js` 缓存。

发布油猴更新流程：

```bash
npm run typecheck
npm run build
npm run deploy
```

部署后确认线上版本：

```bash
curl -s https://notes.edmund.xin/floating-notes.user.js | sed -n '1,20p'
curl -s https://notes.edmund.xin/embed/inject-floating-notes.js | sed -n '1,15p'
```

如果用户仍然看到旧版本，让用户在 Tampermonkey 里手动更新脚本，或删除旧脚本后重新打开安装地址。

## npm run 指令说明

### `npm run dev`

启动 Vite 本地开发服务。

```bash
npm run dev -- --port 5174
```

用于主站和 `embed-demo.html` 的本地 UI 调试。

### `npm start`

`npm run dev` 的别名。

```bash
npm start
```

适合习惯使用 `npm start` 的场景。

### `npm run build:widget`

只构建嵌入式 React widget。

```bash
npm run build:widget
```

输出并覆盖：

```text
public/embed/floating-notes-widget.js
```

当只改了 `client/widget` 或 `client/shared`，想快速刷新嵌入脚本产物时使用。

### `npm run build`

完整生产构建。

```bash
npm run build
```

执行顺序：

1. `npm run build:widget`
2. `vite build`

用于部署前构建主站、Worker 和嵌入式脚本。

### `npm run deploy`

构建并部署到 Cloudflare Workers。

```bash
npm run deploy
```

等价于：

```bash
npm run build
wrangler deploy
```

### `npm run preview`

启动 Vite 预览服务，用于查看生产构建后的前端效果。

```bash
npm run preview -- --port 4173
```

注意：预览服务主要看静态前端表现；涉及 Cloudflare Workers/D1 行为时，仍以 `wrangler dev` 或线上 Worker 为准。

### `npm run typecheck`

运行 TypeScript 类型检查。

```bash
npm run typecheck
```

会检查 Worker 端和 React 前端：

```text
tsc -p tsconfig.json
tsc -p tsconfig.client.json
```

提交或部署前建议先跑。

### `npm test`

先构建，再运行 Vitest。

```bash
npm test
```

当前项目使用 Cloudflare Vitest Workers pool。如果遇到 Worker runtime 或 `cloudflare:test-internal` 相关错误，先确认是不是测试环境问题，再判断是否为业务代码回归。

### `npm run cf-typegen`

根据 `wrangler.jsonc` 生成 Cloudflare Worker 类型。

```bash
npm run cf-typegen
```

修改 D1、KV、R2、环境变量、Assets binding 等 Wrangler binding 后运行。

## 常见问题

### 主站能保存，油猴保存失败并提示 JSON 解析错误

如果报错类似：

```text
Unexpected token '<', "<!doctype "... is not valid JSON
```

通常表示 widget 请求了目标网页自己的 `/notes`，拿到 HTML 后按 JSON 解析。检查油猴脚本是否已经更新到最新版本，并确认：

```js
// @require https://notes.edmund.xin/embed/floating-notes-widget.js?v=当前版本
```

同时确认油猴入口初始化时使用：

```js
apiBase: "https://notes.edmund.xin"
```

### 本地页面出现两个浮球或行为和预期不同

检查 Tampermonkey 是否也注入到了本地页面。本项目默认排除了：

```text
localhost
127.0.0.1
```

如果临时改过 `@exclude`，本地调试时可能出现重复注入。

### 修改了 widget 但用户还看到旧功能

升级版本号并重新部署：

```text
client/widget/entry.tsx
public/embed/inject-floating-notes.js
public/floating-notes.user.js
```

然后让用户更新 Tampermonkey 脚本。
