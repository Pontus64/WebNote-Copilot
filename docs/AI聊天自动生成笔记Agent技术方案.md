# AI 聊天生成笔记 Agent 技术方案

## Summary

这个能力属于轻量 agent：AI 在聊天中识别“生成/整理/保存为笔记”的意图，并准备一个受控工具动作 `create_note`。但工具不会立刻写入笔记，而是先生成一条需要用户确认的 assistant 消息：

```text
需要我帮你生成一篇「今日待做」的笔记吗？
```

只有用户点击这条消息下方 `.ai-message-actions` 中的“需要”后，后端才真正创建笔记；点击“不需要”则只标记本次建议已拒绝，不创建笔记。用户也可以不点击任何按钮继续聊天，pending 状态会保留在这条消息上。

v1 不引入 Cloudflare Agents SDK。当前 Cloudflare Workers + D1 + DeepSeek 链路足够支撑“意图识别 + 单工具候选 + 用户确认 + D1 写入”。

## 是不是 Agent

这里可以按轻量 agent 理解：

- 普通聊天机器人：只生成文本。
- 手动自动化：用户点击固定按钮，程序执行固定动作。
- 轻量 agent：模型理解用户意图，选择是否提出一个受控工具动作。
- 完整 agent 应用：具备长期状态、多工具规划、异步任务、外部事件响应等能力。

本方案处在第三层。AI 能识别用户想“生成笔记”，并生成 `title`、`markdown` 作为工具候选；最终执行权仍交给用户确认，避免误触发写库。

## 关键词命中还是意图识别

不建议只靠关键词命中。关键词只做预筛选，最终由 LLM 结构化意图识别决定。

关键词能覆盖：

```text
帮我生成一篇待做笔记
保存成笔记
生成笔记
```

但自然表达会更复杂：

```text
把刚才这个方案落一篇文档
这个整理成待办给我记下来
按刚才讨论的内容帮我沉淀一下
这个方案先收一下，后面我再看
```

推荐策略：

- 关键词预筛选：减少无关请求的意图识别成本。
- LLM 输出 strict JSON：决定 `chat` 还是 `create_note`。
- 低置信度或字段不完整：回退普通聊天。
- 命中 `create_note`：只进入待确认态，不直接创建笔记。

## 目标体验

### 明确创建

用户：

```text
帮我生成一篇待做笔记，内容是今天要买菜、写日报、整理需求。
```

系统行为：

- Worker 保存 user message。
- Worker 调用 DeepSeek 非流式意图识别。
- 识别为 `create_note` 后，生成标题和 Markdown。
- Worker 保存 assistant message，内容为：

```text
需要我帮你生成一篇「今日待做」的笔记吗？
```

- 该 assistant message 的 `.ai-message-actions` 只显示“需要 / 不需要”。
- 用户点击“需要”后才写入 D1 `notes` 表，并刷新笔记列表。
- 用户点击“不需要”后不写入笔记，操作栏过渡回普通工具栏。

### 基于上下文创建

用户先和 AI 聊出方案，然后说：

```text
把刚才这个方案整理成一篇技术方案笔记
```

系统行为：

- 读取当前线程最近上下文。
- 由 DeepSeek 判断是否是创建笔记意图。
- 生成候选标题和 Markdown。
- 先询问用户是否需要生成该标题的笔记。
- 用户确认后再创建笔记。

### 用户忽略确认

用户可以不点击“需要”或“不需要”，继续发送其他消息、切换页面或稍后再处理。pending 状态保存在 `auth_chat_messages.metadata`，不会阻塞聊天流程。

## 总体架构

```text
ChatApp.tsx
  |
  | POST /api/chat/threads/:threadId/messages
  v
Cloudflare Worker src/index.ts
  |
  | 1. 保存 user message
  | 2. 读取最近线程消息
  | 3. 关键词预筛选
  | 4. DeepSeek strict JSON 意图识别
  | 5. action = chat        -> 走现有流式回复
  | 6. action = create_note -> 保存 pending assistant message
  v
D1 auth_chat_messages
  |
  | 用户点击“需要”
  v
POST /api/chat/threads/:threadId/messages/:messageId/agent-note
  |
  | decision = confirm -> 写入 notes，更新 message metadata
  | decision = dismiss -> 只更新 message metadata
  v
D1 notes / auth_chat_messages
```

继续复用单 Worker 架构，不通过 Worker 内部 HTTP 调用自己的 `/api/notes`。确认创建时直接使用 D1 binding 调用内部 `insertNote()`，避免权限绕路和额外网络跳转。

## 后端数据结构

### AgentAction

```ts
type AgentAction =
  | { action: "chat"; reply?: string }
  | {
      action: "create_note";
      title: string;
      markdown: string;
      reply: string;
      confidence?: number;
    };
```

`create_note` 只是候选动作，不代表立即写入笔记。

### pending metadata

```json
{
  "agentAction": "pending_create_note",
  "agentNoteStatus": "pending",
  "title": "今日待做",
  "markdown": "# 今日待做\n\n- [ ] 买菜",
  "confidence": 0.92
}
```

### created metadata

确认创建后更新为：

```json
{
  "agentAction": "pending_create_note",
  "agentNoteStatus": "created",
  "title": "今日待做",
  "noteId": "uuid",
  "noteTitle": "今日待做",
  "confidence": 0.92
}
```

创建后移除 metadata 中的 `markdown`，避免同一份正文长期重复存储。

### dismissed metadata

用户点击“不需要”后更新为：

```json
{
  "agentAction": "pending_create_note",
  "agentNoteStatus": "dismissed",
  "title": "今日待做",
  "confidence": 0.92
}
```

同样移除 `markdown`。

## 后端接口

### 发送聊天消息

```http
POST /api/chat/threads/:threadId/messages
```

普通聊天仍返回原有流式文本。

如果识别到 `create_note`，返回纯文本确认问题，并带响应头：

```http
X-Floating-Notes-Action: note_pending
X-Floating-Notes-Message-Id: <assistantMessageId>
```

前端用这个 message id 绑定确认按钮。

### 处理确认

```http
POST /api/chat/threads/:threadId/messages/:messageId/agent-note
Content-Type: application/json

{
  "decision": "confirm"
}
```

行为：

- 校验当前用户拥有该 thread/message。
- 校验 message 是 pending agent note。
- 从 metadata 读取 `title`、`markdown`。
- 调用内部 `insertNote()` 创建笔记。
- 更新 message metadata 为 `created`。
- 返回：

```json
{
  "status": "created",
  "note": {
    "id": "uuid",
    "title": "今日待做",
    "markdown": "# 今日待做\n\n- [ ] 买菜"
  }
}
```

重复 confirm 已创建的同一条 message 不会重复创建笔记，只返回已创建状态和 `noteId`。

### 处理拒绝

```http
POST /api/chat/threads/:threadId/messages/:messageId/agent-note
Content-Type: application/json

{
  "decision": "dismiss"
}
```

行为：

- 不创建笔记。
- 更新 message metadata 为 `dismissed`。
- 返回：

```json
{
  "status": "dismissed"
}
```

## 前端交互

`ChatApp.tsx` 保持现有聊天发送入口。收到 `X-Floating-Notes-Action: note_pending` 后，把 `messageId`、`threadId` 写入 assistant-ui 的 `metadata.custom`。

只有满足以下条件的 assistant message 替换工具栏：

```ts
metadata.custom.agentAction === "pending_create_note"
metadata.custom.agentNoteStatus === "pending"
```

该消息下方 `.ai-message-actions` 显示：

- “需要”：点击后按钮显示转圈，调用确认接口，成功后触发 `notifyNotesChanged({ animateSave: true })`，再过渡回普通工具栏。
- “不需要”：点击后立即过渡回普通工具栏，同时异步调用 dismiss 接口。

其他 AI 回复不受影响，仍显示原来的：

- 复制回复
- 存为笔记
- 总结概要

## 安全边界

v1 只开放一个受控工具：`create_note`。

必须满足：

- 未登录用户不能触发 pending 或确认创建。
- 用户只能确认自己 thread 下自己的 assistant message。
- 模型不能传入或覆盖 `userId`。
- 模型不能指定 `noteId`。
- 模型不能删除、更新、覆盖已有笔记。
- 模型不能上传附件。
- Markdown 为空时不能创建。
- 标题为空时使用正文或 `AI笔记` 兜底。
- 超长标题和正文需要截断。

当前限制：

- `title` 最大 80 字符。
- `markdown` 最大 30,000 字符。
- 最近上下文最多取 20 条消息。

## 错误处理

| 场景 | 处理 |
| --- | --- |
| DeepSeek 未配置 | 回到现有聊天错误回复，不创建 pending |
| 意图识别 JSON 解析失败 | 回退普通聊天 |
| action 非法 | 回退普通聊天 |
| confidence 过低 | 回退普通聊天 |
| title 为空 | 用正文生成标题或 `AI笔记` |
| markdown 为空 | 回退普通聊天或确认接口返回 400 |
| message 不属于当前用户 | 返回 404 |
| message 不是 pending agent note | 返回 400 |
| 重复 confirm | 不重复创建，返回已有 `noteId` |

## 和现有手动存笔记的关系

确认式 agent 不替代现有按钮：

- “存为笔记”：仍用于把某条 AI 回复原样存入笔记。
- “总结概要”：仍用于对某条 AI 回复生成概要再存入笔记。
- “选区笔记”：仍用于把用户选中的文本直接存入笔记。
- “聊天生成笔记 agent”：用于自然语言请求，如“帮我生成一篇待做笔记”。

这些入口共用最终 D1 写入逻辑，避免标题、excerpt、schemaVersion 等字段规则分叉。

## 是否引入 Cloudflare Agents SDK

v1 不建议引入。

原因：

- 当前只有一个工具候选：创建笔记。
- 聊天线程和消息历史已经由 D1 管理。
- 没有 WebSocket 实时协同、任务调度、长期 agent 状态、多工具规划等复杂需求。
- 引入 Agents SDK 会增加架构复杂度和迁移成本。

后续如果需要长期状态、定时提醒、后台工作流、多工具组合或实时连接，再重新评估 Agents SDK。

## 实施清单

- 拆出 `insertNote()`，让 HTTP 创建和 agent 确认共用同一写入逻辑。
- 新增 `routeAgentAction()`，用 DeepSeek 非流式 strict JSON 做意图识别。
- 聊天 POST 链路中将 `create_note` 变成 pending assistant message。
- 新增 `POST /api/chat/threads/:threadId/messages/:messageId/agent-note`。
- 前端只替换 pending assistant message 的 `.ai-message-actions`。
- “需要”按钮支持 loading，成功后刷新笔记列表并过渡回普通工具栏。
- “不需要”按钮直接过渡回普通工具栏，并同步 dismiss 状态。
- 补充 pending、confirm、重复 confirm、dismiss、无 DeepSeek key 不创建的测试。

## Test Plan

### 后端

- 普通聊天：
  - 输入“解释一下 D1 是什么”。
  - 不应创建 pending，也不应创建 notes 记录。

- 明确创建：
  - 输入“帮我生成一篇待做笔记，内容是买菜、写日报”。
  - 应返回 `note_pending` header。
  - notes 表仍为空。
  - assistant message metadata 为 pending。

- 确认创建：
  - 对 pending message 调用 `decision=confirm`。
  - 应创建 notes 记录。
  - assistant message metadata 更新为 created。

- 重复确认：
  - 对已 created message 再 confirm。
  - 不应重复创建 notes。

- 拒绝创建：
  - 对 pending message 调用 `decision=dismiss`。
  - notes 表仍为空。
  - assistant message metadata 更新为 dismissed。

### 前端

- pending assistant message 只显示“需要 / 不需要”。
- 普通 assistant message 仍显示“复制回复 / 存为笔记 / 总结概要”。
- 点击“需要”时按钮转圈，成功后恢复并过渡到普通工具栏。
- 点击“不需要”时直接过渡到普通工具栏。
- 用户不点击按钮继续聊天时，聊天输入和发送不受影响。

### 命令

```bash
npm run typecheck
npm test
```

## 参考文档

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare Workers Best Practices: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare D1 Worker API: https://developers.cloudflare.com/d1/worker-api/
- Cloudflare Agents: https://developers.cloudflare.com/agents/
