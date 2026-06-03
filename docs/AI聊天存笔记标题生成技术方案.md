# AI 聊天存笔记标题生成技术方案

## Summary

当前 AI 聊天页已经支持三类手动存笔记入口：

- AI 回复下方的“存为笔记”
- AI 回复下方的“总结概要”
- 聊天页/外部浮窗选中文本后的“笔记”

这些入口现在的标题生成方式偏机械：直接截取正文前若干字，再追加省略号。目标优化是：笔记正文保持原本内容不变，但标题改为由 AI 根据正文生成一个 30 字以内的短标题，并且不再出现 `...` 或 `…`。

这个方案只处理“用户已经明确点击存笔记”的标题生成，不处理“用户在聊天中说一句话后由 AI 自动创建笔记”的 agent 能力。自动创建笔记能力仍归属 `docs/AI聊天自动生成笔记Agent技术方案.md`。

## 当前状态

当前相关代码分布如下：

- `client/app/ChatApp.tsx`
  - 聊天页主体。
  - AI 回复操作区包含“存为笔记”“总结概要”。
  - 聊天页内选中文本工具栏也在这里处理。
  - 现有 `makeNoteTitle()` 会按正文前 18 个字符截断并追加省略号。
- `client/shared/FloatingNotesCore.tsx`
  - 主站悬浮抽屉、外部 embed、油猴脚本共用的浮窗实现。
  - 外部页面选词“笔记”走这里的 `saveSelectionNote()`。
  - 现有 `makeSelectionTitle()` 会按正文前 10 个字符截断并追加省略号。
- `src/index.ts`
  - Worker API。
  - 已有 `/api/chat/summary`，通过 DeepSeek 非流式调用生成概要。
  - 已有 `/api/notes`，负责创建笔记并写入 D1。
- `client/shared/apiClient.ts`
  - 聊天相关 API client。
  - 目前已有 `summarizeChatContent()`。

问题点：

- 标题不是语义标题，只是正文截断。
- 标题末尾固定带省略号，信息密度低。
- AI 回复、概要、选词三个入口需要统一规则，否则用户看到的笔记列表会不一致。
- 外部浮窗运行在宿主页面内，不能直接依赖宿主页面访问主站登录态；需要继续走 iframe bridge。

## 目标体验

### AI 回复存为笔记

用户点击某条 AI 回复下方的“存为笔记”。

期望行为：

- 笔记正文仍然是完整 AI 回复内容。
- 标题由 AI 根据完整回复生成，例如 `标题生成优化`。
- 标题长度控制在 30 字以内。
- 标题不包含省略号、引号、Markdown 标记或 `标题:` 前缀。

### 总结概要

用户点击某条 AI 回复下方的“总结概要”。

期望行为：

- 先通过已有概要能力生成 summary。
- 笔记正文保存 summary，而不是原始回复。
- 标题基于最终保存的 summary 生成，而不是基于原始回复生成。
- 如果概要成功但标题生成失败，仍然保存概要笔记，标题使用 `AI概要`。

### 选词存笔记

用户在聊天页或外部页面选中文本后点击“笔记”。

期望行为：

- 笔记正文是选中的原文。
- 标题由 AI 根据选中文本生成。
- 标题生成失败时仍然保存笔记，标题使用 `新笔记`。
- 外部 embed 和油猴脚本中的选词存笔记也使用同一套标题生成逻辑。

## 后端方案

### 新增接口

新增 authenticated API：

```http
POST /api/chat/title
Content-Type: application/json

{
  "content": "要保存为笔记的正文"
}
```

响应：

```json
{
  "title": "标题生成优化"
}
```

错误行为：

- 未登录：沿用现有认证逻辑，返回 401。
- `content` 为空：返回 400，message 可使用 `title content is required`。
- DeepSeek 未配置或调用失败：返回 503/502；前端负责 fallback 后继续保存。

### DeepSeek 调用

复用现有 DeepSeek 配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

请求方式和 `/api/chat/summary` 保持一致：

- `POST ${getDeepSeekBaseUrl(env)}/chat/completions`
- `stream: false`
- `thinking: { type: "disabled" }`
- `model: env.DEEPSEEK_MODEL || DEEPSEEK_DEFAULT_MODEL`

建议 system prompt：

```text
Generate a concise note title for the user's text.
Use the same language as the text.
Return only the title.
The title must be 30 characters or fewer.
Do not use quotes, markdown, punctuation, labels, or ellipses.
Do not add facts that are not in the text.
```

user message 直接传入正文内容。

### 标题清洗

不能完全信任模型输出。Worker 在返回前做最终清洗：

- `trim()`
- 去掉开头的 `标题:`、`Title:`、`#` 等包装。
- 去掉首尾引号、反引号、书名号、括号。
- 去掉句末标点和省略号：`.`、`。`、`!`、`！`、`?`、`？`、`...`、`…`。
- 合并多余空白。
- 使用 `Array.from()` 按 Unicode 字符截断到 30 个字符。
- 清洗后为空时视为失败，返回 502。

后端返回的 `title` 必须已经是最终可直接入库的标题。前端不再追加省略号。

### Worker 实现边界

- 不新增 D1 表和迁移。
- 不新增 R2/KV/Durable Object/Queue 绑定。
- 不修改 `wrangler.jsonc`，因此不需要运行 `npx wrangler types`。
- 不把 DeepSeek API key 写入源码或文档示例。
- 所有 fetch promise 都要 `await`，不要引入 floating promise。
- 不增加模块级可变请求状态。

官方参考：

- Cloudflare Workers docs: https://developers.cloudflare.com/workers/
- Workers best practices: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/

## 前端方案

### API client

在 `client/shared/apiClient.ts` 增加：

```ts
export function generateChatTitle(apiBase: string, content: string) {
  return apiRequest<{ title: string }>(apiBase, "/api/chat/title", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}
```

在 `client/app/ChatApp.tsx` 中增加本地 helper：

```ts
async function generateTitleOrFallback(
  apiBase: string,
  content: string,
  fallback: string
) {
  try {
    const { title } = await generateChatTitle(apiBase, content);
    return title || fallback;
  } catch (error) {
    console.error(error);
    return fallback;
  }
}
```

保底标题固定为：

- AI 回复存笔记：`AI笔记`
- 总结概要：`AI概要`
- 选词存笔记：`新笔记`

不再使用正文截断作为 fallback，避免重新出现“前几个字 + 省略号”。

### AI 回复存为笔记

当前逻辑：

```ts
await createNote({ title: makeNoteTitle(text, "AI回复"), markdown: text }, apiBase);
```

改为：

```ts
const title = await generateTitleOrFallback(apiBase, text, "AI笔记");
await createNote({ title, markdown: text }, apiBase);
```

正文 `markdown` 不变。

### 总结概要

当前逻辑：

```ts
const { summary } = await summarizeChatContent(apiBase, text);
await createNote({ title: makeNoteTitle(summary, "AI概要"), markdown: summary }, apiBase);
```

改为：

```ts
const { summary } = await summarizeChatContent(apiBase, text);
const title = await generateTitleOrFallback(apiBase, summary, "AI概要");
await createNote({ title, markdown: summary }, apiBase);
```

这里标题基于 summary 生成，和最终保存正文保持一致。

### 聊天页选词存笔记

当前逻辑：

```ts
void createNote({ title: makeNoteTitle(text), markdown: text }, apiBase)
```

改为先生成标题：

```ts
void (async () => {
  const title = await generateTitleOrFallback(apiBase, text, "新笔记");
  await createNote({ title, markdown: text }, apiBase);
})();
```

保留原来的保存动画、toast、`notifyNotesChanged({ animateSave: true })` 行为。

## 外部浮窗 bridge 方案

外部页面里的 `FloatingNotesCore` 可能运行在任意网站。它不能可靠直接使用主站 localStorage/cookie，所以现有创建、更新、删除、上传都通过 iframe 中的聊天页 bridge 转发。

标题生成也需要走同一条 bridge。

### 扩展 bridge request 类型

在 `client/shared/FloatingNotesCore.tsx` 的 `NoteBridgeRequest` 中增加：

```ts
| { action: "title"; payload: { content: string } }
```

增加当前上下文 helper：

```ts
const generateCurrentTitle = useCallback(
  async (content: string) => {
    if (useNotesBridge()) {
      const result = await requestNotesBridge<{ title: string }>({
        action: "title",
        payload: { content },
      });
      return result.title;
    }
    const { title } = await generateChatTitle(apiBase, content);
    return title;
  },
  [apiBase, requestNotesBridge, useNotesBridge]
);
```

再加 fallback helper：

```ts
const generateCurrentTitleOrFallback = useCallback(
  async (content: string, fallback: string) => {
    try {
      return (await generateCurrentTitle(content)) || fallback;
    } catch (error) {
      console.error(error);
      return fallback;
    }
  },
  [generateCurrentTitle]
);
```

### ChatApp bridge handler

在 `client/app/ChatApp.tsx` 的 `handleNotesBridgeRequest()` 中增加：

```ts
if (action === "title") {
  const content = typeof payload?.content === "string" ? payload.content : "";
  respond({ ok: true, data: await generateChatTitle(apiBase, content) });
  return;
}
```

这样外部浮窗选词保存时，标题接口仍由主站 iframe 发起，沿用主站登录态。

### 浮窗选词保存

当前逻辑：

```ts
await createCurrentNote({ title: makeSelectionTitle(content), markdown: content });
```

改为：

```ts
const title = await generateCurrentTitleOrFallback(content, "新笔记");
await createCurrentNote({ title, markdown: content });
```

同时删除旧的 `makeSelectionTitle()`。

## 分发同步

这次改动会触达 `client/shared/FloatingNotesCore.tsx`，外部 embed 和油猴脚本依赖构建后的 widget bundle。只改源码不够，需要同步分发版本。

版本从当前 `1.0.23` bump 到 `1.0.24`：

- `client/widget/entry.tsx`
- `public/embed/inject-floating-notes.js`
- `public/floating-notes.user.js`

同时重建：

```bash
npm run build:widget
```

`npm run build` 会先执行 `build:widget`，也可以直接作为完整构建验证。

需要确认：

- `public/embed/floating-notes-widget.js` 已更新。
- `public/embed/inject-floating-notes.js` 的 `WIDGET_VERSION` 是 `1.0.24`。
- `public/floating-notes.user.js` 的 `@version` 和 `@require ?v=` 都是 `1.0.24`。
- 浏览器实际加载的 `window.FloatingNotes.version` 是 `1.0.24`。

## Test Plan

### Worker API

在 `test/miniflare.spec.ts` 增加：

- 未登录请求 `/api/chat/title` 返回 401。
- 登录后空 `content` 返回 400，message 为 `title content is required`。
- 未配置 `DEEPSEEK_API_KEY` 时返回 503，前端保存流程应 fallback。
- 如果本地环境存在 `DEEPSEEK_API_KEY`，增加可选真实接口测试，断言：
  - 返回 200。
  - `title` 为非空字符串。
  - `Array.from(title).length` 大于 0 且不超过 30。
  - 不包含 `...` 或 `…`。

### 前端类型与构建

执行：

```bash
npm run typecheck
npm test
```

`npm test` 会先执行 `npm run build` 再跑 Vitest。构建中如果出现 Wrangler 日志目录 `EPERM` 警告，只要命令 exit code 为 0 且目标产物存在，就按警告处理。

### 手工验收

主站：

- AI 回复点击“存为笔记”，笔记列表标题是 AI 生成短标题，不带省略号，正文完整。
- AI 回复点击“总结概要”，笔记正文是概要，标题基于概要生成。
- 聊天页内选词点击“笔记”，标题由 AI 生成。

外部 embed：

- 普通网页通过 `inject-floating-notes.js` 加载浮窗。
- 选中文本点击“笔记”，保存成功。
- 新笔记标题不是正文截断，也不带省略号。
- DevTools 中确认实际加载的 widget URL 带 `v=1.0.24`。

油猴脚本：

- 更新或重新安装 `floating-notes.user.js`。
- 确认 `@version` 和 `@require` 都是 `1.0.24`。
- 选词存笔记行为和 embed 一致。

## Failure Handling

- 标题接口失败不阻断保存。
  - AI 回复：保存为 `AI笔记`。
  - 总结概要：保存为 `AI概要`。
  - 选词：保存为 `新笔记`。
- 概要接口失败时不创建概要笔记，保持现有“概要失败”提示。
- 创建笔记失败时仍提示“保存失败”，不吞掉真实存储错误。
- 外部 bridge 未就绪时保持现有错误提示，例如“AI 聊天页未响应”或“请先在 AI 聊天页登录后查看笔记”。

## Acceptance Criteria

- 所有自动保存标题入口都不再调用旧截断函数。
- 新建笔记标题不包含 `...` 或 `…`。
- 三类入口都能保存原有正文，不因为标题生成失败而丢失正文。
- `/api/chat/title` 不绕过登录认证。
- 不新增数据库迁移和 Cloudflare 绑定。
- widget、injector、userscript 版本一致，外部页面不会继续加载旧标题逻辑。
