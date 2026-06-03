# Milkdown Markdown 笔记详情页 v2 重构技术方案

## 1. 背景与目标

当前工程将 AI 聊天和悬浮笔记结合在同一套产品中：

- 主站通过 React 页面提供 AI 聊天和悬浮笔记入口。
- 嵌入脚本和油猴脚本复用同一个 React Widget。
- AI 聊天页通过 iframe 嵌入抽屉，并通过 `postMessage` 与宿主 Widget 同步主题、笔记变化和跨域笔记操作。
- Worker 后端通过 Cloudflare D1 保存笔记、用户和聊天记录。

当前笔记详情页位于 `client/shared/FloatingNotesCore.tsx`，使用普通 `input + textarea` 编辑标题和正文。该编辑方式只能保存纯文本，无法提供成熟的 Markdown 文档体验。

本次重构目标是：

1. 使用 Milkdown Crepe 将笔记详情页升级为类似 Typora 的 Markdown 编辑器。
2. 将笔记 API 和 D1 表结构升级到 v2 Markdown 协议。
3. 保持主站、嵌入脚本和油猴脚本复用同一套 Widget 行为。
4. 保持 AI 聊天页现有能力，包括划词问 AI、划词保存、AI 回复存笔记和总结概要。
5. 为下一版本的图片粘贴上传到 Cloudflare R2 预留数据模型和代码扩展点。

## 2. 已确认的功能边界

### 2.1 本版本实现

- 仅替换笔记详情页编辑器，不改造 AI 聊天输入框。
- 使用 Milkdown Crepe 开箱版，不从底层手工拼装编辑器插件。
- 支持基础 GFM Markdown：
  - 标题
  - 粗体、斜体
  - 有序列表、无序列表
  - 引用
  - 行内代码、代码块
  - 链接
  - 表格
  - 任务列表
- 标题继续使用独立字段，详情页头部保留标题输入框。
- Markdown 正文使用独立 `markdown` 字段。
- 使用手动保存策略：
  - 保留保存按钮。
  - 支持 `Ctrl+S` 和 `Cmd+S`。
  - 存在未保存修改时，返回或关闭详情页需要提示。
- 桌面端详情页保持当前抽屉宽度，不切换到全屏或加宽模式。
- 图片粘贴时拦截默认行为并提示“图片上传将在下一版本支持”。
- 新增 D1 asset 元数据表，为下一版本预留；R2 binding 在真正实现上传时再启用。

### 2.2 本版本不实现

- 不实现图片实际上传到 R2。
- 不允许将图片转换成 base64 后写入 Markdown 或 D1。
- 不实现数学公式、流程图或其他扩展语法。
- 不修改 AI 聊天输入框为 Markdown 编辑器。
- 不迁移旧笔记数据。
- 不保留旧笔记 API 协议兼容层。

## 3. 当前工程结构

本次改造涉及以下核心位置：

| 模块 | 位置 | 当前职责 |
| --- | --- | --- |
| 笔记抽屉和详情页 | `client/shared/FloatingNotesCore.tsx` | 主站、嵌入脚本、油猴脚本共用的笔记列表和详情编辑 |
| 笔记类型 | `client/shared/types.ts` | `Note` 和 `DraftNote` 类型 |
| 笔记 API 客户端 | `client/shared/notesApi.ts` | 调用 `/api/notes` |
| AI 聊天页 | `client/app/ChatApp.tsx` | AI 回复存笔记、总结概要、划词保存和跨域 notes bridge |
| Worker 后端 | `src/index.ts` | `/api/notes`、`/notes`、认证和聊天 API |
| D1 迁移 | `migrations/` | D1 表结构 |
| Worker 配置 | `wrangler.jsonc` | Assets、D1 和未来 R2 binding |
| Widget 入口 | `client/widget/entry.tsx` | Widget 挂载、Shadow DOM 和 Widget 版本 |
| 嵌入入口 | `public/embed/inject-floating-notes.js` | 动态加载远端 Widget |
| 油猴入口 | `public/floating-notes.user.js` | 通过 `@require` 加载版本化 Widget |

主站、嵌入脚本和油猴脚本最终必须复用构建产物：

```text
client/widget/entry.tsx
  -> npm run build:widget
  -> public/embed/floating-notes-widget.js
```

因此不能为嵌入脚本单独复制一套 Markdown 编辑器实现。

## 4. Milkdown 集成方案

### 4.1 依赖

安装同一版本的 Milkdown 包：

```bash
npm install @milkdown/react@7.21.1 @milkdown/crepe@7.21.1 @milkdown/kit@7.21.1
```

Milkdown 官方资源：

- 官方文档：[https://milkdown.dev/docs](https://milkdown.dev/docs)
- React 集成：[https://milkdown.dev/docs/recipes/react](https://milkdown.dev/docs/recipes/react)
- Crepe 指南：[https://milkdown.dev/docs/guide/using-crepe](https://milkdown.dev/docs/guide/using-crepe)
- GitHub 仓库：[https://github.com/Milkdown/milkdown](https://github.com/Milkdown/milkdown)

### 4.2 编辑器组件

新增独立的 Markdown 编辑器组件，例如：

```text
client/shared/MarkdownNoteEditor.tsx
```

该组件负责：

- 初始化和销毁 Crepe 编辑器实例。
- 接收初始 Markdown 内容。
- 在编辑器内容变化时通知父组件，更新本地草稿状态。
- 检测编辑器是否有未保存修改。
- 响应 `Ctrl+S` 和 `Cmd+S` 保存快捷键。
- 拦截包含图片文件的粘贴事件。
- 图片粘贴时调用宿主 toast，并留下 R2 上传 TODO。

组件接口建议如下：

```ts
type MarkdownNoteEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  onSave: () => void;
  onUnsupportedImagePaste: () => void;
};
```

### 4.3 Shadow DOM 样式

Widget 通过 `client/widget/entry.tsx` 将 `floatingNotes.css?inline` 注入 Shadow DOM。Milkdown/Crepe 的基础样式和本项目覆盖样式必须进入同一条构建链，确保以下入口行为一致：

- 主站悬浮抽屉
- 普通网页嵌入脚本
- 油猴脚本

样式覆盖应保证：

- 编辑器占满详情页剩余高度。
- 编辑区域可滚动。
- 表格和代码块在当前窄抽屉中支持横向滚动。
- 深色和浅色主题都能正常显示。
- 标题输入框、保存按钮、返回按钮和编辑器不会重叠。
- 移动端底部抽屉中工具栏和正文仍可操作。

### 4.4 图片粘贴 TODO

本版检测到图片文件后：

1. 阻止默认粘贴。
2. 不插入 base64。
3. 不调用 Worker 上传接口。
4. 显示 toast：

```text
图片上传将在下一版本支持
```

代码中保留明确 TODO：

```ts
// TODO(next): upload pasted image to R2, persist note_assets metadata,
// and insert the returned Markdown image URL at the current cursor position.
```

## 5. 笔记 v2 数据模型

### 5.1 前端类型

`client/shared/types.ts` 中将笔记类型升级为：

```ts
export type Note = {
  id: string;
  title: string;
  markdown: string;
  excerpt: string;
  contentFormat: "markdown";
  schemaVersion: 2;
  assetCount: number;
  createdAt: number;
  updatedAt: number;
};

export type DraftNote = {
  title: string;
  markdown: string;
};
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `title` | 独立标题字段，用于详情页头部和列表标题 |
| `markdown` | Markdown 原始正文 |
| `excerpt` | 后端生成的列表摘要，避免列表端重复解析 Markdown |
| `contentFormat` | 固定为 `markdown` |
| `schemaVersion` | 固定为 `2` |
| `assetCount` | 关联资源数量，本版本固定为 `0` |

### 5.2 D1 表结构

新增迁移文件：

```text
migrations/0004_rebuild_notes_v2.sql
```

本次已经确认允许清空旧笔记数据，因此迁移直接删除并重建 `notes` 表。只删除笔记表，不删除账号、会话和聊天记录。

建议表结构：

```sql
DROP TABLE IF EXISTS note_assets;
DROP TABLE IF EXISTS notes;

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  markdown TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 2,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX idx_notes_user_updated_at
ON notes(user_id, updated_at DESC, created_at DESC);

CREATE TABLE note_assets (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX idx_note_assets_note_id
ON note_assets(note_id, created_at ASC);
```

注意事项：

- `note_assets` 本版只预留表结构，不写入数据。
- 下一版本应在删除笔记时同步删除关联 R2 对象，避免孤儿对象。
- 如果启用 SQLite 外键约束，需要验证 Worker 请求上下文中的 D1 行为。

## 6. Worker API 升级

### 6.1 API 路径

保留现有路径，但直接升级协议：

```text
GET    /api/notes
POST   /api/notes
GET    /api/notes/:id
PUT    /api/notes/:id
DELETE /api/notes/:id

GET    /notes
POST   /notes
GET    /notes/:id
PUT    /notes/:id
DELETE /notes/:id
```

`/notes` 和 `/api/notes` 仍然指向同一套 Worker 逻辑。

### 6.2 请求体

创建和更新统一接收：

```json
{
  "title": "笔记标题",
  "markdown": "# Markdown 正文"
}
```

旧字段 `content` 不再属于 v2 成功协议。

### 6.3 响应体

响应统一返回：

```json
{
  "id": "uuid",
  "title": "笔记标题",
  "markdown": "# Markdown 正文",
  "excerpt": "Markdown 正文",
  "contentFormat": "markdown",
  "schemaVersion": 2,
  "assetCount": 0,
  "createdAt": 1779714294031,
  "updatedAt": 1779714294031
}
```

### 6.4 摘要生成

Worker 在创建和更新时生成 `excerpt`：

- 去除 Markdown 常见标记。
- 合并连续空白。
- 截断到适合列表展示的长度。
- 不调用 AI，不增加额外网络请求。

### 6.5 R2 Binding

本版本不在 `wrangler.jsonc` 中声明 R2 binding，避免尚未启用 R2 的账号被无用配置阻断本地开发和部署验证。

下一版本实现图片上传时，再在 `wrangler.jsonc` 中新增：

```jsonc
"r2_buckets": [
  {
    "binding": "NOTE_ASSETS",
    "bucket_name": "y-note-assets"
  }
]
```

修改 binding 后运行：

```bash
npx wrangler types
```

下一版本更新后的 Worker 环境中应包含：

```ts
NOTE_ASSETS: R2Bucket;
```

Cloudflare 官方资源：

- Workers 最佳实践：[https://developers.cloudflare.com/workers/best-practices/workers-best-practices/](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- D1 Worker API：[https://developers.cloudflare.com/d1/worker-api/d1-database/](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- R2 Workers API：[https://developers.cloudflare.com/r2/api/workers/workers-api-reference/](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- D1 限制：[https://developers.cloudflare.com/d1/platform/limits/](https://developers.cloudflare.com/d1/platform/limits/)
- R2 限制：[https://developers.cloudflare.com/r2/platform/limits/](https://developers.cloudflare.com/r2/platform/limits/)

Worker 内部继续使用 Cloudflare binding：

```ts
env.wranglerdemo.prepare(...)
env.NOTE_ASSETS.put(...)
```

不要从 Worker 内部调用 Cloudflare REST API。

## 7. 前端调用链改造

### 7.1 笔记列表和详情页

`client/shared/FloatingNotesCore.tsx` 中：

- 将 `detailContent` 改为 Markdown 草稿状态，例如 `detailMarkdown`。
- 将普通 `textarea.detail-content` 替换为 `MarkdownNoteEditor`。
- 列表摘要改为使用后端返回的 `note.excerpt`。
- 新建笔记时初始化空 Markdown。
- 打开详情页时读取 `note.markdown`。
- 保存时发送 `{ title, markdown }`。
- 返回或关闭时检查脏状态。

### 7.2 AI 聊天联动

`client/app/ChatApp.tsx` 中现有笔记创建入口都改为 v2：

- AI 聊天划词保存。
- AI 回复“存为笔记”。
- AI 回复“总结概要”。
- iframe notes bridge 的 create/update。

创建正文时直接把纯文本作为合法 Markdown 写入：

```ts
createNote({
  title: makeNoteTitle(text),
  markdown: text,
});
```

无需额外转义为 HTML。

### 7.3 宿主页面划词保存

宿主页面划词保存仍保留现有粒子和虫洞动效。只修改写入字段：

```ts
createCurrentNote({
  title: makeSelectionTitle(content),
  markdown: content,
});
```

不得因为编辑器重构删除现有动效或改变划词工具栏行为。

## 8. Widget 和脚本版本同步

修改共享 Widget 后必须重新构建：

```bash
npm run build:widget
```

同时更新以下版本：

| 文件 | 更新内容 |
| --- | --- |
| `client/widget/entry.tsx` | `WIDGET_VERSION` |
| `public/embed/inject-floating-notes.js` | Widget query 参数 |
| `public/floating-notes.user.js` | `@version` 和 `@require ?v=` |

版本必须一致，避免浏览器或 Tampermonkey 缓存旧 Widget。

## 9. 实施顺序

1. 安装 Milkdown 依赖并新增 `MarkdownNoteEditor`。
2. 新增 D1 v2 迁移和 `note_assets` 预留表。
3. 保留 R2 上传 TODO；本版本不生成 R2 binding 类型。
4. 升级 Worker 中的笔记类型、SQL、请求体和响应体。
5. 升级前端 `Note`、`DraftNote` 和 `notesApi`。
6. 替换 `FloatingNotesCore` 中的详情编辑区域。
7. 升级 AI 聊天页和 iframe notes bridge 的笔记写入。
8. 增加图片粘贴拦截和下一版本 TODO。
9. 补充 Worker 测试。
10. 重建 Widget，统一 bump Widget、嵌入脚本和油猴脚本版本。
11. 完成本地 D1 迁移和主站、嵌入、油猴三入口验收。

## 10. 测试和验收

### 10.1 Worker 测试

更新 `test/miniflare.spec.ts`：

- 注册用户后笔记列表为空。
- 创建 Markdown 笔记成功。
- 读取 Markdown 笔记成功。
- 更新 Markdown 笔记成功。
- 删除 Markdown 笔记成功。
- 响应包含 `markdown`、`excerpt`、`contentFormat`、`schemaVersion` 和 `assetCount`。
- `schemaVersion` 固定为 `2`。
- `assetCount` 在本版本固定为 `0`。
- 旧 `content` 字段不再作为成功协议依赖。

### 10.2 D1 迁移验证

本地应用迁移后验证：

- `notes` 表已经是 v2 结构。
- `note_assets` 表已经创建。
- 旧笔记数据已经清空。
- `auth_users`、`auth_sessions`、`auth_chat_threads` 和 `auth_chat_messages` 不受影响。

### 10.3 前端功能验证

主站、嵌入脚本和油猴脚本分别验证：

- 打开笔记列表。
- 新建笔记。
- 输入标题。
- 编辑基础 GFM Markdown。
- 使用保存按钮保存。
- 使用 `Ctrl+S` 或 `Cmd+S` 保存。
- 返回列表后摘要正确。
- 重新打开后 Markdown 内容正确。
- 有未保存修改时返回或关闭会提示。
- 深色和浅色主题正常。
- 移动端底部抽屉可以编辑和保存。

### 10.4 AI 聊天联动验证

- 聊天页划词保存后产生 v2 Markdown 笔记。
- AI 回复“存为笔记”后产生 v2 Markdown 笔记。
- AI 回复“总结概要”后产生 v2 Markdown 笔记。
- 宿主页面划词保存后粒子和虫洞动效仍存在。
- 跨域 iframe notes bridge 可以正常 list/create/update/delete。

### 10.5 图片粘贴验证

- 粘贴图片时不插入 base64。
- 粘贴图片时不请求 Worker 上传接口。
- 粘贴图片时不写入 R2。
- 用户可以看到“图片上传将在下一版本支持”提示。

### 10.6 验证命令

```bash
npm run typecheck
npm run build
npm run build:widget
npm test
```

`npm test` 中包含真实 DeepSeek 请求，需要提供真实 `DEEPSEEK_API_KEY`。缺少该变量导致的失败属于环境配置问题，不应直接判定为代码回归。

## 11. 部署注意事项

上线前必须确认：

1. 已应用远程 D1 迁移：

```bash
npx wrangler d1 migrations apply wranglerdemo --remote
```

2. 已生成最新 Worker 类型：

```bash
npx wrangler types
```

3. 已重建共享 Widget：

```bash
npm run build:widget
```

4. Widget、嵌入脚本和油猴脚本版本一致。
5. 已明确接受旧笔记数据被清空。

## 12. 下一版本：R2 图片上传

下一版本补充以下能力：

1. 创建 `y-note-assets` R2 bucket，并在 `wrangler.jsonc` 中新增 `NOTE_ASSETS` binding。
2. 编辑器粘贴图片后调用 Worker 上传接口。
3. Worker 校验 MIME 类型、文件大小和用户身份。
4. Worker 生成不可预测的 R2 key。
5. Worker 使用 `env.NOTE_ASSETS.put(...)` 写入 R2。
6. Worker 向 `note_assets` 写入对象元数据。
7. 前端在当前光标位置插入 Markdown 图片链接。
8. 删除笔记时同步删除关联 R2 对象。
9. 增加对象访问权限、缓存和清理策略。

该能力不属于本版本验收范围。
