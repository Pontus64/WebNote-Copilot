# assistant-ui 聊天页重构技术方案

## Summary

- 用 `@assistant-ui/react` 重建主站和嵌入入口的 AI 聊天体验，移动端优先复刻简版 ChatGPT：顶部栏、左侧历史抽屉、底部纯文本输入框、无文件上传/附件/下载。
- 后端从当前只有 `/notes` 的 D1 API 扩展为登录用户系统、聊天线程、消息历史、DeepSeek 兼容接口流式代理；R2 第一版不接入。
- 主站直接渲染聊天 app；嵌入脚本只做浮窗、划词工具和 iframe 容器，完整聊天和登录在 `notes.edmund.xin` 同源 iframe 内运行，避免宿主页面接触密码和会话 token。

## Key Changes

- 新增依赖：`@assistant-ui/react`、Markdown 渲染所需的 assistant-ui/React Markdown 相关包；不用默认文件上传组件。
- D1 新迁移：
  - `users`: `id,email,password_hash,password_salt,password_params_json,created_at,updated_at`
  - `sessions`: `id,user_id,token_hash,created_at,expires_at,revoked_at`
  - `chat_threads`: `id,user_id,title,created_at,updated_at,archived_at`
  - `chat_messages`: `id,thread_id,user_id,role,content,status,created_at,metadata_json`
  - `notes` 增加 `user_id` 和索引；首次注册用户自动认领旧 `user_id IS NULL` 笔记。
- Auth API：
  - `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
  - 邮箱密码注册登录；PBKDF2-SHA256 加盐哈希；主站用 `HttpOnly Secure SameSite=Lax` cookie；iframe 同时可用同源 `localStorage` session token 作为 cookie 受限时的 fallback。
- Chat/notes API：
  - `GET/POST /api/chat/threads`, `GET/PATCH/DELETE /api/chat/threads/:id`
  - `GET /api/chat/threads/:id/messages`
  - `POST /api/chat/threads/:id/messages`：保存用户消息，调用 DeepSeek `https://api.deepseek.com/chat/completions`，默认模型 `deepseek-v4-flash`，流式返回并保存 assistant 消息。
  - `/api/notes` 按登录用户隔离；旧 `/notes` 保留为兼容别名但同样要求认证。
- Wrangler：
  - 增加 `run_worker_first`：`/api/*`, `/notes`, `/notes/*`
  - 增加非密配置 `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`
  - `DEEPSEEK_API_KEY` 用 `wrangler secret put` 配置；不在仓库写入密钥。
  - 修改绑定/vars 后运行 `npx wrangler types`。

## UI Behavior

- 主站首页直接进入聊天页，不做 landing page。
- 左上角菜单打开历史抽屉：新建聊天、线程列表、重命名、删除、退出登录。
- 聊天输入只支持文本；发送中显示流式回复和停止按钮；空输入禁用发送。
- AI 消息提供复制和“存为笔记”；划词工具的“问AI”打开当前聊天并把选中文本放入输入框，“笔记”通过 iframe postMessage 走已登录用户的 notes API。
- 嵌入脚本和油猴脚本继续保留版本号机制，发布时同步升级 `WIDGET_VERSION`、`@version`、`@require ?v=`。

## Test Plan

- 后端单测覆盖注册、登录、退出、未登录 401、用户间 notes/thread 隔离、旧 notes 首用户认领、聊天消息保存、DeepSeek 失败时的错误落库。
- 前端验证：移动端 430px 宽度下聊天页、历史抽屉、输入框、流式状态不重叠；桌面主站和嵌入 iframe 都可用。
- 命令：`npm run typecheck`、`npm run build`、`npm test`；如 Workers pool 测试环境报 `cloudflare:test-internal`，记录为工具链问题并用直接 route 测试补充验证。
- 部署前验证官方文档：assistant-ui installation/runtime、Cloudflare Workers static assets/D1/secrets、DeepSeek OpenAI-compatible chat API。

## Assumptions

- DeepSeek 默认用 `deepseek-v4-flash`；不做模型切换。
- 第一版不接 R2，不做文件上传、附件、导出下载。
- 找回密码、邮箱验证、限流锁号、邀请码、管理员后台不在第一版。
- 参考文档：assistant-ui docs https://www.assistant-ui.com/docs ，Cloudflare Workers docs https://developers.cloudflare.com/workers/ ，DeepSeek docs https://api-docs.deepseek.com/ 。
